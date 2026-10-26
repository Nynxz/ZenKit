"""The Memory panel's route: one snapshot of where VRAM and RAM are going.

GET /zensuite/memory returns, in one read:

- every torch device: total / free VRAM, what torch holds (allocated, reserved), and, from NVML
  on NVIDIA (or torch's own amdsmi-backed calls on ROCm), utilization, temperature, power, fan
  and the VRAM other processes use;
- system RAM and swap, this process's resident size, and the pinned host memory ComfyUI keeps;
- the models ComfyUI has loaded: size, how much sits on the device, and, under dynamic VRAM
  (comfy-aimdo), the page-by-page residency of each model and its watermark.

The route only reads. It never allocates on the GPU (see the "no GPU off the queue" rule: work
on the device from a route races the sampler under aimdo), and freeing memory goes through
ComfyUI's own POST /free, which the execution thread acts on between prompts. Unloading one
model (POST /zensuite/memory/unload) rides the same path: the request is left as a queue flag and
done on the execution thread when it next checks its flags.
"""

from __future__ import annotations

import logging
import os
import threading
import time

from aiohttp import web

log = logging.getLogger("zenkit.memory")

try:
    from server import PromptServer

    _routes = PromptServer.instance.routes
except Exception as e:  # noqa: BLE001  # pragma: no cover - only outside a running server
    _routes = None
    print(f"[ZenKit] memory route unavailable: {e}")

#: comfy-aimdo's page size: residency is reported per 32 MiB page.
AIMDO_PAGE = 32 << 20


def _aimdo():
    """comfy-aimdo's model_vbar and control modules when dynamic VRAM is on, else None."""
    try:
        import comfy.memory_management as mm

        if not mm.aimdo_enabled:
            return None
        from comfy_aimdo import control, model_vbar

        return (control, model_vbar) if control.lib is not None else None
    except Exception:  # noqa: BLE001 - aimdo is optional
        return None


def _aimdo_version() -> str | None:
    try:
        from comfy_aimdo._version import version

        return version
    except Exception:  # noqa: BLE001
        return None


# --- GPU telemetry --------------------------------------------------------------------------

_nvml_ready: bool | None = None
_nvml_handles: dict[int, object] = {}


def _nvml():
    """pynvml, initialised once, or None (no NVIDIA driver, or the package isn't installed)."""
    global _nvml_ready
    try:
        import pynvml
    except Exception:  # noqa: BLE001
        return None
    if _nvml_ready is None:
        try:
            pynvml.nvmlInit()
            _nvml_ready = True
        except Exception as e:  # noqa: BLE001
            log.debug("NVML unavailable: %s", e)
            _nvml_ready = False
    return pynvml if _nvml_ready else None


def _nvml_handle(nv, index: int):
    """The NVML handle for torch's cuda:<index>. Matched by UUID, so CUDA_VISIBLE_DEVICES (which
    renumbers torch's devices but not NVML's) can't point it at the wrong card."""
    if index in _nvml_handles:
        return _nvml_handles[index]
    handle = None
    try:
        import torch

        uuid = str(torch.cuda.get_device_properties(index).uuid)
        want = uuid if uuid.startswith("GPU-") else "GPU-" + uuid
        handle = nv.nvmlDeviceGetHandleByUUID(want)
    except Exception:  # noqa: BLE001 - older torch has no uuid; fall back to the index
        try:
            if not os.environ.get("CUDA_VISIBLE_DEVICES"):
                handle = nv.nvmlDeviceGetHandleByIndex(index)
        except Exception:  # noqa: BLE001
            handle = None
    _nvml_handles[index] = handle
    return handle


def _try(fn, *args):
    try:
        return fn(*args)
    except Exception:  # noqa: BLE001 - every metric is optional
        return None


def _nvml_metrics(nv, handle) -> dict:
    util = _try(nv.nvmlDeviceGetUtilizationRates, handle)
    mem = _try(nv.nvmlDeviceGetMemoryInfo, handle)
    power = _try(nv.nvmlDeviceGetPowerUsage, handle)
    limit = _try(nv.nvmlDeviceGetEnforcedPowerLimit, handle)
    return {
        "source": "nvml",
        "util": util.gpu if util else None,
        "mem_util": util.memory if util else None,
        "temp": _try(nv.nvmlDeviceGetTemperature, handle, nv.NVML_TEMPERATURE_GPU),
        "power": power / 1000 if power is not None else None,
        "power_limit": limit / 1000 if limit is not None else None,
        "fan": _try(nv.nvmlDeviceGetFanSpeed, handle),
        "clock": _try(nv.nvmlDeviceGetClockInfo, handle, nv.NVML_CLOCK_SM),
        "used": mem.used if mem else None,
    }


def _torch_metrics(torch, index: int) -> dict:
    """torch's own telemetry calls: NVML underneath on NVIDIA, amdsmi on ROCm."""
    power = _try(torch.cuda.power_draw, index)
    return {
        "source": "torch",
        "util": _try(torch.cuda.utilization, index),
        "mem_util": None,
        "temp": _try(torch.cuda.temperature, index),
        "power": power / 1000 if power is not None else None,
        "power_limit": None,
        "fan": None,
        "clock": _try(torch.cuda.clock_rate, index),
        "used": None,
    }


def _telemetry(torch, device) -> dict | None:
    if device.type != "cuda":
        return None
    index = device.index or 0
    nv = None if getattr(torch.version, "hip", None) else _nvml()
    handle = _nvml_handle(nv, index) if nv else None
    metrics = _nvml_metrics(nv, handle) if handle is not None else _torch_metrics(torch, index)
    return metrics if any(v is not None for k, v in metrics.items() if k != "source") else None


# --- devices --------------------------------------------------------------------------------


def _device_name(torch, device) -> str:
    if device.type == "cuda":
        return _try(torch.cuda.get_device_name, device) or str(device)
    if device.type == "xpu":
        return _try(torch.xpu.get_device_name, device) or str(device)
    return device.type.upper()


def _devices(aimdo) -> list[dict]:
    import comfy.model_management as cmm
    import torch

    primary = cmm.get_torch_device()
    devices = list(cmm.get_all_torch_devices())
    devices = [primary] + [d for d in devices if d != primary]
    out = []
    for d in devices:
        if d.type == "cpu":
            continue
        total, torch_total = cmm.get_total_memory(d, torch_total_too=True)
        free, torch_free = cmm.get_free_memory(d, torch_free_too=True)
        entry = {
            "key": str(d),
            "name": _device_name(torch, d),
            "type": d.type,
            "index": d.index,
            "total": int(total),
            "free": int(free),
            "torch_reserved": int(torch_total),
            "torch_allocated": int(torch_total - torch_free),
            "telemetry": _telemetry(torch, d),
            "aimdo": None,
        }
        if aimdo and d.type == "cuda":
            control, _ = aimdo
            ctx = _try(control.get_devctx, d.index or 0)
            # Not `vbars_analyze`: it's aimdo's diagnostic, logging a warning for every page the
            # sampler has pinned, and walks every vbar while the sampler changes them.
            entry["aimdo"] = {"used": _try(control.lib.get_total_vram_usage, ctx) if ctx else None}
        out.append(entry)
    return out


# --- RAM ------------------------------------------------------------------------------------


def _ram() -> dict:
    import comfy.model_management as cmm
    import psutil

    vm = psutil.virtual_memory()
    swap = _try(psutil.swap_memory)
    rss = _try(lambda: psutil.Process().memory_info().rss)
    pinned_max = getattr(cmm, "MAX_PINNED_MEMORY", -1)
    return {
        "total": vm.total,
        "available": vm.available,
        "process": rss,
        "pinned": int(getattr(cmm, "TOTAL_PINNED_MEMORY", 0) or 0),
        "pinned_max": int(pinned_max) if pinned_max and pinned_max > 0 else None,
        "swap_total": swap.total if swap else None,
        "swap_used": swap.used if swap else None,
    }


# --- models ---------------------------------------------------------------------------------


def _model_name(patcher) -> str:
    inner = getattr(patcher, "model", None)
    config = getattr(inner, "model_config", None)
    if config is not None:
        return type(config).__name__
    return type(inner).__name__ if inner is not None else "model"


def _model_kind(patcher) -> str:
    inner = getattr(patcher, "model", None)
    name = type(inner).__name__.lower()
    if getattr(inner, "model_config", None) is not None:
        return "diffusion"
    if "vae" in name or "autoencoder" in name:
        return "vae"
    if "clip" in name or "te" in name or "encoder" in name or "llm" in name:
        return "text"
    return "other"


def _residency(vbar, size: int) -> dict | None:
    """The model's pages as a string, one character per 32 MiB page: '0' absent, '1' in VRAM,
    '2' pinned in RAM, '3' both. Trimmed to the model's own pages (the vbar reserves address
    space for casts far beyond it) unless later pages are in use."""
    flags = _try(vbar.get_residency)
    if not flags:
        return None
    pages = max(1, -(-size // AIMDO_PAGE))
    last = max((i for i, f in enumerate(flags) if f), default=-1)
    flags = flags[: max(pages, last + 1)]
    watermark = _try(vbar.get_watermark)
    return {
        "page": AIMDO_PAGE,
        "pages": "".join(str(f & 3) for f in flags),
        "watermark": int(watermark) if watermark is not None else None,
    }


def _models(aimdo) -> list[dict]:
    import comfy.model_management as cmm

    out = []
    for i, lm in enumerate(list(cmm.current_loaded_models)):
        patcher = lm.model
        if patcher is None:
            continue
        size = int(_try(patcher.model_size) or 0)
        loaded = int(_try(patcher.loaded_size) or 0)
        dynamic = bool(_try(patcher.is_dynamic))
        entry = {
            "index": i,
            # Stable while the model stays loaded; what /zensuite/memory/unload takes.
            "id": str(id(lm)),
            "name": _model_name(patcher),
            "kind": _model_kind(patcher),
            "device": str(lm.device),
            "size": size,
            "loaded": min(loaded, size) if size else loaded,
            "pinned": int(_try(patcher.pinned_memory_size) or 0),
            "dynamic": dynamic,
            "in_use": bool(lm.currently_used),
            "residency": None,
        }
        if aimdo and dynamic:
            vbars = getattr(getattr(patcher, "model", None), "dynamic_vbars", None) or {}
            vbar = vbars.get(lm.device)
            if vbar is not None:
                entry["residency"] = _residency(vbar, size)
        out.append(entry)
    return out


def _running() -> bool:
    try:
        return bool(PromptServer.instance.prompt_queue.currently_running)
    except Exception:  # noqa: BLE001
        return False


def snapshot() -> dict:
    aimdo = _aimdo()
    return {
        "time": time.time(),
        "running": _running(),
        "aimdo": {"enabled": aimdo is not None, "version": _aimdo_version()},
        "devices": _devices(aimdo),
        "ram": _ram(),
        "models": _models(aimdo),
    }


# --- unloading one model ---------------------------------------------------------------------

#: The flag a per-model unload leaves on ComfyUI's prompt queue: the ids of the models to drop.
UNLOAD_FLAG = "zenkit_unload_models"
_hook_lock = threading.Lock()


def _unload_models(ids: set[str]) -> int:
    """Drop the loaded models with these ids. Runs on the execution thread only."""
    import comfy.model_management as cmm

    hit = [lm for lm in list(cmm.current_loaded_models) if str(id(lm)) in ids]
    for lm in hit:
        lm.currently_used = False
        if lm.model is not None and lm.model_unload():
            cmm.current_loaded_models.remove(lm)
    if hit:
        cmm.soft_empty_cache()
    return len(hit)


def _install_unload_hook(queue) -> None:
    """Have the execution thread act on UNLOAD_FLAG. Its loop reads the queue's flags between
    prompts (and right away when idle, since setting a flag wakes it), so wrapping the queue's
    get_flags runs the unload there, the same moment /free's unload would, and never mid-run."""
    with _hook_lock:
        if getattr(queue.get_flags, "_zenkit", False):
            return
        original = queue.get_flags

        def get_flags(reset=True):
            flags = original(reset)
            ids = flags.pop(UNLOAD_FLAG, None)
            if ids and reset:
                try:
                    _unload_models(set(ids))
                except Exception:
                    log.exception("unloading models failed")
            return flags

        get_flags._zenkit = True
        queue.get_flags = get_flags


def request_unload(ids: list[str]) -> None:
    queue = PromptServer.instance.prompt_queue
    _install_unload_hook(queue)
    with queue.mutex:
        pending = set(queue.flags.get(UNLOAD_FLAG) or ())
    queue.set_flag(UNLOAD_FLAG, sorted(pending | set(ids)))


if _routes is not None:

    @_routes.post("/zensuite/memory/unload")
    async def _memory_unload(request):
        try:
            body = await request.json()
            ids = [str(i) for i in body.get("ids") or []]
            if not ids:
                return web.json_response({"error": "no model ids"}, status=400)
            request_unload(ids)
            return web.json_response({"queued": len(ids)})
        except Exception as e:
            log.exception("unload request failed")
            return web.json_response({"error": str(e)}, status=500)

    @_routes.get("/zensuite/memory")
    async def _memory(request):
        try:
            return web.json_response(snapshot())
        except Exception as e:  # report, never take the panel down
            log.exception("memory snapshot failed")
            return web.json_response({"error": str(e)}, status=500)

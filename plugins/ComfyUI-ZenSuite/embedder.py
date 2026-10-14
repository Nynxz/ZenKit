"""Multimodal embedding models for visual search: images, videos (and audio) and text into one
vector space, so a description finds the files that show it. `load(path)` picks the backend.

Qwen3-VL-Embedding runs on ComfyUI's own Qwen3-VL code. ComfyUI ships the architecture
(comfy.text_encoders.qwen3vl) but only the 4B/8B/32B text configs its models use, so the size is
read from the weights here. Loading goes through comfy.sd.CLIP, so int8/fp8 checkpoints in
ComfyUI's quantized format load as they are. Takes a .safetensors file or a Hugging Face folder's
model.safetensors.

EmbeddingGemma 2 has no ComfyUI implementation, so it runs on transformers from its Hugging Face
folder (model.safetensors next to its config.json and processor files).

Either way the model sits in a ComfyUI model patcher: placed, offloaded and freed by ComfyUI's
model management like any other model.
"""

from __future__ import annotations

import dataclasses
import json
import os
import re

import comfy.model_management
import comfy.model_patcher
import comfy.sd
import comfy.utils
import numpy as np
import torch
import torch.nn.functional as F
from comfy import sd1_clip
from comfy.text_encoders import qwen3vl
from comfy.text_encoders.hunyuan_video import llama_detect
from comfy.text_encoders.llama import Llama2_, Qwen3VL_8BConfig
from transformers import AutoModel, AutoProcessor

NAME = "qwen3vl_embed"
END = 151643  # <|endoftext|>: Qwen3-VL-Embedding's vector is the hidden state at this token
DOCUMENT = "Represent the user's input."
QUERY = "Retrieve images that match the description."
IMAGE_SIZE = 512  # longest side an image is embedded at (Qwen)


def _config(sd: dict) -> tuple[dict, dict]:
    """(text config, vision config) of a Qwen3-VL state dict."""
    layers = {int(m.group(1)) for k in sd if (m := re.match(r"model\.layers\.(\d+)\.", k))}
    blocks = {int(m.group(1)) for k in sd if (m := re.match(r"visual\.blocks\.(\d+)\.", k))}
    if not layers or not blocks:
        raise ValueError("not a Qwen3-VL embedding model (no language or vision layers)")
    head_dim = 128
    text = {
        "hidden_size": sd["model.embed_tokens.weight"].shape[1],
        "intermediate_size": sd["model.layers.0.mlp.gate_proj.weight"].shape[0],
        "num_hidden_layers": len(layers),
        "num_attention_heads": sd["model.layers.0.self_attn.q_proj.weight"].shape[0] // head_dim,
        "num_key_value_heads": sd["model.layers.0.self_attn.k_proj.weight"].shape[0] // head_dim,
    }
    width, depth = sd["visual.blocks.0.attn.proj.weight"].shape[0], len(blocks)
    for vision in qwen3vl.QWEN3VL_VISION.values():
        if vision["hidden_size"] == width and vision["depth"] == depth:
            return text, {**qwen3vl.QWEN3VL_VISION_COMMON, **vision, "out_hidden_size": text["hidden_size"]}
    raise ValueError(f"unknown Qwen3-VL vision tower ({width} wide, {depth} blocks)")


def _model(text: dict, vision: dict):
    config_class = dataclasses.make_dataclass(
        "Qwen3VLEmbedConfig", [(k, int, dataclasses.field(default=v)) for k, v in text.items()] + [("lm_head", bool, False)],
        bases=(Qwen3VL_8BConfig,),
    )

    class Qwen3VLEmbed(qwen3vl.Qwen3VL):
        def __init__(self, config_dict, dtype, device, operations):
            torch.nn.Module.__init__(self)
            config = config_class(**config_dict)
            self.num_layers = config.num_hidden_layers
            self.model = Llama2_(config, device=device, dtype=dtype, ops=operations)
            self.visual = qwen3vl.Qwen3VLVisionModel(vision, device=device, dtype=dtype, ops=operations)
            self.dtype = dtype

    class ClipModel(sd1_clip.SDClipModel):
        def __init__(self, device="cpu", dtype=None, model_options={}):
            # The end token is declared so the trailing <|endoftext|> stays unmasked.
            super().__init__(device=device, layer="last", textmodel_json_config={}, dtype=dtype,
                             special_tokens={"pad": END, "end": END}, layer_norm_hidden_state=False,
                             model_class=Qwen3VLEmbed, enable_attention_masks=True,
                             return_attention_masks=True, model_options=model_options)
    return ClipModel


class _Tokenizer(qwen3vl.Qwen3VLTokenizer):
    def __init__(self, embedding_directory=None, tokenizer_data={}):
        super().__init__(embedding_directory=embedding_directory, tokenizer_data=tokenizer_data, model_type=NAME)


class QwenEmbedder:
    kinds = ("image", "video")
    # How far below the best match a result may score and still be shown.
    spread = 0.12

    def __init__(self, path: str):
        sd = comfy.utils.load_torch_file(path)
        sd = comfy.utils.state_dict_prefix_replace(sd, {"model.language_model.": "model.", "model.visual.": "visual."})
        sd.pop("lm_head.weight", None)
        clip_model = _model(*_config(sd))
        detect = llama_detect(sd)

        class TE(sd1_clip.SD1ClipModel):
            def __init__(self, device="cpu", dtype=None, model_options={}):
                dtype = detect.get("dtype_llama", dtype)
                if "llama_quantization_metadata" in detect:
                    model_options = {**model_options, "quantization_metadata": detect["llama_quantization_metadata"]}
                super().__init__(device=device, dtype=dtype, name=NAME, clip_model=clip_model, model_options=model_options)

        class Target:
            clip = TE
            tokenizer = _Tokenizer
            params = {}

        self.clip = comfy.sd.CLIP(Target, state_dict=[sd], parameters=comfy.utils.calculate_parameters(sd))
        self.dim = sd["model.embed_tokens.weight"].shape[1]

    def _encode(self, text: str, instruction: str, image: torch.Tensor | None = None) -> np.ndarray:
        kw = {"images": [image]} if image is not None else {}
        tokens = self.clip.tokenize(text, system_prompt=instruction, thinking=True, **kw)
        for row in tokens[NAME]:
            row.append((END, 1.0))
        cond = self.clip.encode_from_tokens(tokens, return_dict=True)["cond"]
        return F.normalize(cond[0, -1].float(), dim=-1).cpu().numpy().astype(np.float16)

    def image(self, img) -> np.ndarray:
        """A PIL image's vector."""
        img = img.convert("RGB")
        img.thumbnail((IMAGE_SIZE, IMAGE_SIZE), 3)  # bicubic, as Qwen's own processor
        pixels = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0)[None]
        return self._encode("", DOCUMENT, pixels)

    def video(self, frames: list) -> np.ndarray:
        """A video's vector, from its middle frame."""
        return self.image(frames[len(frames) // 2])

    def query(self, text: str) -> np.ndarray:
        """A search's vector."""
        return self._encode(text, QUERY)


class GemmaEmbedder:
    kinds = ("image", "video", "audio")
    spread = 0.06
    QUERY = "task: search result | query: "  # media take no prefix

    def __init__(self, folder: str):
        load_device = comfy.model_management.get_torch_device()
        # float16 overflows this model (NaN embeddings), so bfloat16 or float32 only.
        dtype = torch.bfloat16 if comfy.model_management.should_use_bf16(load_device) else torch.float32
        # Held in a plain module: the patcher sets `.device` on what it manages, which a
        # transformers model only has as a read-only property.
        holder = torch.nn.Module()
        holder.model = AutoModel.from_pretrained(folder, dtype=dtype).eval().requires_grad_(False)
        self.processor = AutoProcessor.from_pretrained(folder)
        # The plain patcher, not CoreModelPatcher: with dynamic VRAM on, that one streams weights
        # through ComfyUI's ops, which transformers layers don't use, so it copied the whole
        # model to the GPU on every call.
        self.patcher = comfy.model_patcher.ModelPatcher(
            holder, load_device=load_device, offload_device=comfy.model_management.unet_offload_device()
        )

    def _encode(self, **inputs) -> np.ndarray:
        comfy.model_management.load_model_gpu(self.patcher)
        batch = self.processor(return_tensors="pt", **inputs)
        batch = {k: v.to(self.patcher.load_device) if torch.is_tensor(v) else v for k, v in batch.items()}
        hidden = self.patcher.model.model(**batch).last_hidden_state.float()
        mask = batch["attention_mask"][..., None].float()
        pooled = (hidden * mask).sum(1) / mask.sum(1)
        return F.normalize(pooled[0], dim=-1).cpu().numpy().astype(np.float16)

    def image(self, img) -> np.ndarray:
        return self._encode(text="<|image|>", images=[[img.convert("RGB")]])

    def video(self, frames: list) -> np.ndarray:
        clip = np.stack([np.asarray(f.convert("RGB")) for f in frames])
        return self._encode(text="<|video|>", videos=[clip], do_sample_frames=False)

    def audio(self, samples: np.ndarray) -> np.ndarray:
        """Mono 16 kHz samples' vector."""
        return self._encode(text="<|audio|>", audio=[samples])

    def query(self, text: str) -> np.ndarray:
        return self._encode(text=self.QUERY + text)


def _gemma(path: str) -> bool:
    config = os.path.join(os.path.dirname(path), "config.json")
    if not os.path.isfile(config):
        return False
    with open(config, encoding="utf-8") as f:
        return json.load(f).get("model_type") == "embedding_gemma2"


def kinds(path: str) -> tuple[str, ...]:
    """The kinds of file the model at `path` embeds, without loading it."""
    return GemmaEmbedder.kinds if _gemma(path) else QwenEmbedder.kinds


def load(path: str):
    """The embedder for a model file: EmbeddingGemma 2 when its folder's config says so."""
    return GemmaEmbedder(os.path.dirname(path)) if _gemma(path) else QwenEmbedder(path)

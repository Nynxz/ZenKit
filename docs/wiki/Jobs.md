# Jobs

A job is progress for long-running work: an indexing pass, a batch export, a model download. Report
it from the browser or from Python and it shows in the taskbar's **Jobs** widget, with a bar,
message and source, and stays listed for a minute after it finishes.

## Minimal example (browser)

```ts
import { startJob } from '@nynxz/zenkit-client'

const job = await startJob('Resize images', { total: files.length, source: 'My Plugin' })
try {
  for (const [i, f] of files.entries()) {
    await resize(f)
    job.update({ current: i + 1, message: f.name })
  }
  job.done()
} catch (e) {
  job.fail(String(e))
}
```

Without ZenKit, `startJob` resolves a handle whose methods do nothing, so no checks are needed.

## Minimal example (Python)

Send the `zenkit.job` websocket event. Every event carries the job's full state, so a tab that
connects mid-job still shows it correctly.

```python
from server import PromptServer

def emit(job_id, name, status, current=0, total=0, message=""):
    PromptServer.instance.send_sync("zenkit.job", {
        "id": job_id,          # stable for the whole job
        "name": name,
        "status": status,      # "start" | "progress" | "done" | "error"
        "current": current,
        "total": total,        # 0 = indeterminate
        "message": message,
        "source": "My Plugin",
    })

emit("myplugin:export:1", "Export batch", "start", 0, 12)
for i in range(1, 13):
    ...
    emit("myplugin:export:1", "Export batch", "progress", i, 12, f"Step {i} of 12")
emit("myplugin:export:1", "Export batch", "done", 12, 12)
```

There is no shared Python helper yet; copy this function. Run the work in an `asyncio` task or thread so the
route returns immediately. Events sent before the browser runtime has installed are buffered (up
to 200) and replayed.

## Fields

| `Job` field              | Meaning                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `id`                     | Unique. Prefix it with your plugin id.                                                                  |
| `name`                   | Shown in the widget.                                                                                    |
| `status`                 | `'start'`, `'progress'`, `'done'`, `'error'`. Anything else is read as `'progress'`.                    |
| `current`, `total`       | Progress. `total: 0` shows an indeterminate bar. On `done` with a `total`, `current` is set to `total`. |
| `message`                | Status line.                                                                                            |
| `source`                 | Who is doing the work.                                                                                  |
| `startedAt`, `updatedAt` | ms timestamps, filled in by ZenKit.                                                                     |

Omitted fields in an update keep their previous value, so a `progress` event can send only
`current`.

## Frontend API

| Call                                                    | Meaning                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `startJob(name, opts?)` / `zen.jobs.start(name, opts?)` | Start a job and return a `JobHandle`. Passing the `id` of an existing job reuses that entry, with `current` reset to 0. |
| `opts`                                                  | `{ id?, total?, message?, source? }`. `id` defaults to `frontend:<time>:<n>`.                                           |
| `handle.update({ current?, total?, message? })`         | Progress.                                                                                                               |
| `handle.done(message?)`, `handle.fail(message?)`        | Finish.                                                                                                                 |
| `zen.jobs.list()`                                       | Running jobs plus up to 10 finished in the last minute.                                                                 |
| `zen.jobs.get(id)`                                      | One job or `null`.                                                                                                      |
| `zen.jobs.on(cb)` / `onJob(cb)`                         | Every job update. Returns unsubscribe.                                                                                  |

### Watching a job in Vue

```ts
import { useJob } from '@nynxz/zenkit-client'

// The running job whose id starts with 'myplugin:export', or null.
const exportJob = useJob((j) => j.id.startsWith('myplugin:export'))
```

`useJob` returns a readonly ref. It goes back to `null` when the job finishes or fails, and stops
listening when the component unmounts.

## Bus mirror

| Event         | Payload                                   |
| ------------- | ----------------------------------------- |
| `job`         | `Job`, on every update                    |
| `job:<id>`    | `Job`, for that id                        |
| `jobs:change` | the job id, on any add, update or removal |

Finished jobs are removed after 60 s, or sooner when more than 10 have finished. The Jobs widget's
"Clear finished" removes them at once.

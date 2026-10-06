# VolX desk bridge

The live city runs as a claude.ai page. That page can read Robinhood through
your claude.ai Robinhood connector, but it cannot reach `volxbot.trade` or your
PC. This bridge closes that gap for the **VOLX** tower (the left one).

`volx_desk_mcp.py` is a small local MCP server. It tails the desk's event log
(`mes-orb-bot/dashboard/live_log.jsonl`) and answers one read-only tool,
`desk_events`. When you open the city in the **Claude desktop app on the desk
PC**, the page calls that tool every 10 seconds. It also saves a compact copy
to the page's own database, so the VOLX tower shows the last synced state on
your phone or in a browser.

The bridge only reads the log file. It never writes to it, never talks to IB,
and never touches credentials, the Databento key or the tunnel config.

## Setup on the desk PC (Windows)

1. Install [uv](https://docs.astral.sh/uv/) if you don't have it:
   `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`
2. In the Claude desktop app open **Settings → Developer → Edit Config**. Add
   the server to `claude_desktop_config.json`, keeping any servers you already
   have:

   ```json
   {
     "mcpServers": {
       "volxdesk": {
         "command": "uv",
         "args": ["run", "C:\\path\\to\\TradingPlatform\\bridge\\volx_desk_mcp.py"]
       }
     }
   }
   ```

   The name must be exactly `volxdesk`. The page addresses it as `host:volxdesk`.
3. Restart the Claude desktop app. The first time the city calls the desk, the
   app asks you to allow it.

The log path defaults to
`%USERPROFILE%\Options back testing\mes-orb-bot\dashboard\live_log.jsonl`. If
yours lives elsewhere, add `"--log", "D:\\…\\live_log.jsonl"` after the script
path in `args`, or set `"env": {"VOLX_LOG": "…"}`.

Without uv, run `pip install "mcp>=1.10" tzdata`. Then use
`"command": "python"` and `"args": ["C:\\path\\to\\…\\volx_desk_mcp.py"]`.

## Checking it

- In the city, the **FEEDS** panel (top left) shows `VOLX DESK · live`. It reads
  `last sync` on devices without the bridge, and `offline` before the first
  sync.
- `desk_status` (not used by the page) reports the log path, bytes read and
  the time of the last desk event. You can call it from any MCP client.
- To test without the app:
  `uv run bridge/volx_desk_mcp.py --log path/to/live_log.jsonl`. It speaks MCP
  over stdio.

## What the tool returns

`desk_events(cursor, epoch, since_date, bar_symbol, bars_since, bars_after, limit)`
returns:

| Field        | Contents                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| `events`     | Desk decisions since `cursor`: armed, fills, brackets, closes, overnight decisions, rolls, … |
| `bars`       | `[t_ms, o, h, l, c, v]` rows for `bar_symbol`, keeping the newest copy of each minute        |
| `last_price` | `{t, c}` of the latest bar                                                                   |
| `cursor`     | Pass back on the next call to get only newer events                                          |
| `epoch`      | Pass back as well; a changed epoch means the bridge restarted or the log rotated             |
| `more`       | `true` when more events are queued                                                           |
| `log_exists` | `false` if the log file is missing                                                           |

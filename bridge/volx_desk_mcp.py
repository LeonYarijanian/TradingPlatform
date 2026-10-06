# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.10", "tzdata"]
# ///
"""VolX desk bridge: a read-only local MCP server for the Neon Trading City page.

The VolX desk (mes-orb-bot's IB paper node) narrates every decision into
dashboard/live_log.jsonl. The live city runs inside claude.ai, which cannot
reach volxbot.trade or this PC directly — but a page opened in the Claude
desktop app can call MCP servers configured on that machine. This is one:
it tails the log and serves it through a single read-only tool.

It never writes to the log, never talks to IB, and never sees credentials.

Run it from the Claude desktop app (Settings → Developer → Edit Config):

    {
      "mcpServers": {
        "volxdesk": {
          "command": "uv",
          "args": ["run", "C:\\\\path\\\\to\\\\TradingPlatform\\\\bridge\\\\volx_desk_mcp.py"]
        }
      }
    }

The server name must be exactly `volxdesk`. The log path defaults to
~/Options back testing/mes-orb-bot/dashboard/live_log.jsonl; override it with
`--log <path>` or the VOLX_LOG environment variable.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import threading
import time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

ET = ZoneInfo("America/New_York")
BAR_KINDS = {"session_bars", "bar"}
# Chart bars older than this are dropped from memory (the page needs two sessions).
BAR_KEEP_DAYS = 5
DEFAULT_LOG = Path.home() / "Options back testing" / "mes-orb-bot" / "dashboard" / "live_log.jsonl"


def _parse_ts(ts: str) -> dt.datetime | None:
    try:
        t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _et_date(t: dt.datetime) -> str:
    return t.astimezone(ET).date().isoformat()


def _et_midnight_ms(date: str) -> int:
    d = dt.date.fromisoformat(date)
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=ET).timestamp() * 1000)


class DeskLog:
    """Incremental tail of live_log.jsonl.

    Non-bar events are kept in arrival order (the page pages through them with
    a cursor). Bar events arrive many times per minute as the candle builds;
    only the newest copy of each minute is kept, per symbol.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.generation = 0
        self._reset()

    def _reset(self) -> None:
        self.generation += 1
        self.epoch = f"{int(time.time())}-{os.getpid()}-{self.generation}"
        self.offset = 0
        self.carry = b""
        self.events: list[dict[str, Any]] = []
        self.bars: dict[str, dict[int, list[float]]] = {}
        self.last_price: dict[str, dict[str, float]] = {}

    def refresh(self) -> bool:
        """Reads whatever was appended since the last call. False if the log is missing."""
        try:
            size = self.path.stat().st_size
        except OSError:
            return False
        if size < self.offset:
            # Truncated or rotated: numbering starts over, so does the page.
            self._reset()
        if size == self.offset:
            return True
        with self.path.open("rb") as f:
            f.seek(self.offset)
            chunk = f.read(size - self.offset)
        self.offset = size
        data = self.carry + chunk
        lines = data.split(b"\n")
        self.carry = lines.pop()  # partial trailing write (or b"")
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=BAR_KEEP_DAYS)).isoformat()[:10]
        for raw in lines:
            raw = raw.strip()
            if raw:
                self._ingest(raw, cutoff)
        self._prune_bars()
        return True

    def _ingest(self, raw: bytes, cutoff: str) -> None:
        is_bar = b'"session_bars"' in raw or b'"kind":"bar"' in raw or b'"kind": "bar"' in raw
        if is_bar:
            # Cheap date check before parsing: most of a long log is old bars.
            i = raw.find(b'"ts":')
            if i >= 0:
                ts = raw[i + 5 : i + 40].strip(b' "')[:10].decode("ascii", "ignore")
                if ts and ts < cutoff:
                    return
        try:
            e = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return
        if not isinstance(e, dict):
            return
        kind = e.get("kind")
        symbol = str(e.get("symbol") or "").upper()
        if kind in BAR_KINDS:
            series = self.bars.setdefault(symbol, {})
            for b in (e.get("data") or {}).get("bars") or []:
                t = _parse_ts(str(b.get("t", "")))
                if t is None:
                    continue
                ms = int(t.timestamp() * 1000)
                try:
                    row = [ms, float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"]), float(b.get("v") or 0)]
                except (KeyError, TypeError, ValueError):
                    continue
                series[ms] = row
                lp = self.last_price.get(symbol)
                if lp is None or ms >= lp["t"]:
                    self.last_price[symbol] = {"t": ms, "c": row[4]}
            return
        if not isinstance(kind, str) or not e.get("ts"):
            return  # server-side markers (seq 0, empty ts) are not desk decisions
        self.events.append(
            {
                "seq": e.get("seq", 0),
                "ts": e.get("ts"),
                "kind": kind,
                "symbol": symbol,
                "strategy": e.get("strategy", ""),
                "text": str(e.get("text", ""))[:600],
                "data": e.get("data") if isinstance(e.get("data"), dict) else {},
            }
        )

    def _prune_bars(self) -> None:
        floor = int((time.time() - BAR_KEEP_DAYS * 86400) * 1000)
        for series in self.bars.values():
            for t in [t for t in series if t < floor]:
                del series[t]


mcp = FastMCP("volxdesk")
desk: DeskLog | None = None


@mcp.tool(
    annotations=ToolAnnotations(title="VolX desk events", readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
)
def desk_events(
    cursor: int = 0,
    epoch: str = "",
    since_date: str = "",
    bar_symbol: str = "MES",
    bars_since: str = "",
    bars_after: int = 0,
    limit: int = 1500,
) -> dict[str, Any]:
    """Read the VolX desk's narrated events (fills, closes, armed levels, decisions) and recent minute bars.

    Pass back `epoch` and `cursor` from the previous answer to get only what is new; a changed
    epoch means the bridge restarted or the log rotated and the answer starts over.
    since_date / bars_since are ET dates (YYYY-MM-DD); bars_after is epoch ms.
    """
    assert desk is not None
    with desk.lock:
        exists = desk.refresh()
        if epoch != desk.epoch:
            cursor = 0
        cursor = max(0, min(int(cursor), len(desk.events)))
        limit = max(1, min(int(limit), 5000))
        out: list[dict[str, Any]] = []
        i = cursor
        while i < len(desk.events) and len(out) < limit:
            e = desk.events[i]
            i += 1
            if since_date:
                t = _parse_ts(str(e["ts"]))
                if t is None or _et_date(t) < since_date:
                    continue
            out.append(e)
        floor = max(_et_midnight_ms(bars_since) if bars_since else 0, int(bars_after or 0))
        series = desk.bars.get(bar_symbol.upper(), {})
        bars = [series[t] for t in sorted(series) if t >= floor]
        return {
            "epoch": desk.epoch,
            "cursor": i,
            "more": i < len(desk.events),
            "events": out,
            "bars": bars,
            "last_price": desk.last_price.get(bar_symbol.upper()),
            "log_exists": exists,
        }


@mcp.tool(annotations=ToolAnnotations(title="VolX desk status", readOnlyHint=True, destructiveHint=False, openWorldHint=False))
def desk_status() -> dict[str, Any]:
    """Health check: is the desk log there, how much has been read, and when the desk last spoke."""
    assert desk is not None
    with desk.lock:
        exists = desk.refresh()
        return {
            "log_path": str(desk.path),
            "log_exists": exists,
            "bytes_read": desk.offset,
            "events": len(desk.events),
            "last_event_ts": desk.events[-1]["ts"] if desk.events else None,
            "bar_symbols": sorted(desk.bars),
            "epoch": desk.epoch,
        }


def main() -> None:
    global desk
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", default=os.environ.get("VOLX_LOG") or str(DEFAULT_LOG), help="path to dashboard/live_log.jsonl")
    args = ap.parse_args()
    desk = DeskLog(Path(args.log).expanduser())
    mcp.run()  # stdio, as the Claude desktop app expects


if __name__ == "__main__":
    main()

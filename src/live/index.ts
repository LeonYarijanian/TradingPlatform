import { RobinhoodFeed } from './robinhoodFeed';
import { LiveRunner } from './runner';
import { VolxFeed } from './volxFeed';

export const liveFeeds = {
  volx: new VolxFeed(),
  robinhood: new RobinhoodFeed(),
};

let runner: LiveRunner | null = null;

/** Starts the live city: ET clock + VolX desk + Robinhood connector. */
export function startLiveCity(): LiveRunner {
  runner ??= new LiveRunner([liveFeeds.volx, liveFeeds.robinhood]);
  runner.start();
  return runner;
}

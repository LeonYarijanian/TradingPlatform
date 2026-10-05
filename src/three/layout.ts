/** Shared world layout constants for the trading city. */
export const VAULT_POS: [number, number, number] = [0, 0, 4.6];
export const PLAZA_RADIUS = 2.7;
export const VAULT_WALL_RADIUS = 1.1;
export const VAULT_WALL_HEIGHT = 0.85;
export const VAULT_BASE_HEIGHT = 0.16;
export const VAULT_DOME_RADIUS = 1.04;

export const TRACK = { cx: 0, cz: 2.8, rx: 12.6, rz: 7.25, y: 0.95 } as const;

export const CITY_CAMERA = {
  position: [0, 9.2, 25.5] as [number, number, number],
  target: [0, 4.3, -1.0] as [number, number, number],
  fov: 42,
};

export const STATION_CAMERA = {
  position: [1.22, 2.18, 2.25] as [number, number, number],
  target: [0.02, 1.27, -0.8] as [number, number, number],
};

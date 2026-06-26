// Re-export shim: the elevation profile + stage labels now live in the shared
// graphics system. Kept so existing imports of './Elevation' stay valid.
export { Elevation, STAGE_TYPE_LABEL } from './graphics';

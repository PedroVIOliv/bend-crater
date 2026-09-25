export type Status = "pass" | "unsafe" | "fail" | "timeout" | "dep_missing";

export const RUNNER = 1;

export interface Pkg {
  hash: string;
  files: Record<string, number>;
  name: string | null;
  version: string | null;
  desc: string;
  ts: number;
  dependents: number;
}

export interface Release {
  version: string;
  published_at: string;
  asset_url: string | null;
}

export interface Todo {
  pkg: string;
  file: string;
  bend: string;
}

export interface Cell extends Todo {
  status: Status;
  error: string;
  ms: number;
  checked_at: string;
  runner: number;
}

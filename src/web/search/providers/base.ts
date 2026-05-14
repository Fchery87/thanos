import type { SearchParams, SearchProviderId, SearchResponse } from "../types";

export abstract class SearchProvider {
  abstract readonly id: SearchProviderId;
  abstract readonly label: string;
  abstract isAvailable(): boolean | Promise<boolean>;
  abstract search(params: SearchParams): Promise<SearchResponse>;
}

export class SearchProviderError extends Error {
  constructor(
    public readonly providerId: SearchProviderId,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

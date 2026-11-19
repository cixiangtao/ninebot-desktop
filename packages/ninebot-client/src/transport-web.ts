/** Compatibility names for the shared portable HTTP transport, including authentication. */
export { createFetchNinebotTransport as createFetchNinebotWebTransport } from "./transport.ts";
export type {
  NinebotHttpMethod as NinebotWebHttpMethod,
  NinebotRequest as NinebotWebRequest,
  NinebotResponse as NinebotWebResponse,
  NinebotTransport as NinebotWebTransport,
  FetchNinebotTransportOptions as FetchNinebotWebTransportOptions,
} from "./transport.ts";
export type { NinebotServiceName as NinebotWebServiceName } from "./service-endpoints.ts";

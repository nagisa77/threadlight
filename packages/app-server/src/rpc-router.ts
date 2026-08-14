export type RpcMethodHandler = (params: unknown) => unknown | Promise<unknown>;

/** Protocol-only method dispatch. Domain services provide handlers; the router
 * owns method lookup and the JSON-RPC "method not found" concern. */
export class RpcMethodRouter<Method extends string> {
  constructor(
    private readonly handlers: Readonly<Record<Method, RpcMethodHandler>>,
  ) {}

  dispatch(method: string, params: unknown): Promise<unknown> {
    const handler = (
      this.handlers as Readonly<Record<string, RpcMethodHandler>>
    )[method];
    if (!handler) {
      return Promise.reject(
        new RpcError(-32601, `Method not found: ${method}`),
      );
    }
    return Promise.resolve(handler(params));
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

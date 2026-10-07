export {};

declare global {
  namespace chrome {
    namespace runtime {
      function sendMessage(message: unknown): Promise<unknown>;
      const onMessage: {
        addListener(
          callback: (
            message: unknown,
            sender: unknown,
            sendResponse: (response?: unknown) => void,
          ) => boolean | void,
        ): void;
      };
    }
    namespace tabs {
      interface Tab {
        id?: number;
        url?: string;
      }
      function query(queryInfo: {
        active?: boolean;
        currentWindow?: boolean;
      }): Promise<Tab[]>;
    }
    namespace scripting {
      interface InjectionResult<T> {
        result: T;
        frameId: number;
      }
      function executeScript<Args extends unknown[], T>(injection: {
        target: { tabId: number };
        func: (...args: Args) => T;
        args?: Args;
        world?: 'ISOLATED' | 'MAIN';
      }): Promise<InjectionResult<Awaited<T>>[]>;
    }
  }
}

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
    namespace permissions {
      function contains(permissions: { origins: string[] }): Promise<boolean>;
      function request(permissions: { origins: string[] }): Promise<boolean>;
    }
    namespace declarativeNetRequest {
      function updateSessionRules(options: {
        removeRuleIds?: number[];
        addRules?: {
          id: number;
          priority: number;
          action: {
            type: 'modifyHeaders';
            requestHeaders: {
              header: string;
              operation: 'set' | 'remove';
              value?: string;
            }[];
          };
          condition: {
            requestDomains: string[];
            resourceTypes: string[];
            tabIds?: number[];
            urlFilter?: string;
          };
        }[];
      }): Promise<void>;
    }
  }
}

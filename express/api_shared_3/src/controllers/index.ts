import { createCallSharedGetController } from "./call-shared-get.controller";
import { createPropagateClientController } from "./propagate-client.controller";
import { createSecureSharedPostController } from "./secure-shared-post.controller";
import type { SharedController, SharedControllerDeps } from "./controller.types";

export function createSharedController(deps: SharedControllerDeps): SharedController {
  return {
    callSharedGet: createCallSharedGetController(deps),
    propagateClient: createPropagateClientController(deps),
    secureSharedPost: createSecureSharedPostController(deps),
  };
}

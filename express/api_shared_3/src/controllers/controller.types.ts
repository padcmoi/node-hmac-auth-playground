import type { Request, Response } from "express";
import type { SharedApiConfig } from "../config/shared.config";
import { InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";

export interface SharedControllerDeps {
  config: SharedApiConfig;
  hmacAuth: InitializedHmacHttpAuth;
}

export interface SharedController {
  callSharedGet: (req: Request, res: Response) => Promise<void>;
  propagateClient: (req: Request, res: Response) => Promise<void>;
  secureSharedPost: (req: Request, res: Response) => void;
}

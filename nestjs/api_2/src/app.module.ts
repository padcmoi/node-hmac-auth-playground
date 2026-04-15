import { DynamicModule, Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { RUNTIME_CONTEXT, type RuntimeContext } from "./runtime-context.js";

@Module({})
export class AppModule {
  static register(runtimeContext: RuntimeContext): DynamicModule {
    return {
      module: AppModule,
      controllers: [AppController],
      providers: [{ provide: RUNTIME_CONTEXT, useValue: runtimeContext }],
    };
  }
}

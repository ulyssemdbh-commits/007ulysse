import { createCoreMethods } from "./core";
import { createServerMethods } from "./serverUtils";
import { createAppMethods } from "./apps";
import { createDeployMethods } from "./deploy";
import { createNginxMethods } from "./nginx";

const service: any = {};

Object.assign(service, createCoreMethods());
Object.assign(service, createServerMethods(service));
Object.assign(service, createAppMethods(service));
Object.assign(service, createDeployMethods(service));
Object.assign(service, createNginxMethods(service));

export const sshService = service as ReturnType<typeof createCoreMethods> &
  ReturnType<typeof createServerMethods> &
  ReturnType<typeof createAppMethods> &
  ReturnType<typeof createDeployMethods> &
  ReturnType<typeof createNginxMethods>;

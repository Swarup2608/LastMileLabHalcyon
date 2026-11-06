/* eslint-disable */
// @ts-nocheck
// Every engine view, by role and view name.
import { createClientOverview } from "./client/overview";
import { createClientProducts } from "./client/products";
import { createClientOrder } from "./client/order";
import { createClientNewOrder } from "./client/newOrder";
import { createClientMessages } from "./client/messages";
import { createAdminOverview } from "./admin/overview";
import { createAdminOrder } from "./admin/order";
import { createAdminExceptions } from "./admin/exceptions";
import { createAdminCarriers } from "./admin/carriers";
import { createAdminClients } from "./admin/clients";
import { createAdminRules } from "./admin/rules";
import { createSimulationTable } from "./admin/simulationTable";
import { createWeekReport } from "./admin/weekReport";

export function createViews(ctx){
  ctx.weekReportHtml=createWeekReport(ctx);
  ctx.simulationTableHtml=createSimulationTable(ctx);
  return {
    client:{overview:createClientOverview(ctx),products:createClientProducts(ctx),order:createClientOrder(ctx),new:createClientNewOrder(ctx),messages:createClientMessages(ctx)},
    admin:{overview:createAdminOverview(ctx),order:createAdminOrder(ctx),exceptions:createAdminExceptions(ctx),carriers:createAdminCarriers(ctx),clients:createAdminClients(ctx),rules:createAdminRules(ctx)},
  };
}

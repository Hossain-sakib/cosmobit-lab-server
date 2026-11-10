import serverless from "serverless-http";
import { isIP } from "node:net";
import { createApp } from "../../src/app.js";
import { serverlessDB } from "../../src/lib/serverlessDb.js";

const serve = serverless(createApp(), {
  basePath: "/.netlify/functions/api",
  binary: ["application/pdf", "image/*"],
});
export async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    await serverlessDB();
    const ip =
      event.headers?.["x-nf-client-connection-ip"] ||
      event.requestContext?.identity?.sourceIp;
    event.requestContext = {
      ...event.requestContext,
      identity: {
        ...event.requestContext?.identity,
        sourceIp: isIP(ip || "") ? ip : "127.0.0.1",
      },
    };
    return await serve(event, context);
  } catch (error) {
    console.error("API initialization failed:", error.name);
    const code = !process.env.MONGODB_URI
      ? "DATABASE_NOT_CONFIGURED"
      : error.code === 18
        ? "DATABASE_AUTHENTICATION_FAILED"
        : [
              "MongoServerSelectionError",
              "MongooseServerSelectionError",
            ].includes(error.name)
          ? "DATABASE_CONNECTION_UNAVAILABLE"
          : error.code === 13
            ? "DATABASE_PERMISSION_DENIED"
            : error.name === "MongoParseError"
              ? "DATABASE_CONFIGURATION_INVALID"
              : "SERVICE_UNAVAILABLE";
    return {
      statusCode: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        status: "unavailable",
        code,
        message: "The service is temporarily unavailable. Please try again.",
      }),
    };
  }
}

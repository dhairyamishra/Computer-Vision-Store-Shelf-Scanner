import { createApiServer } from "./server/index.js";

const port = Number(process.env.PORT ?? 3000);
const server = await createApiServer({ mode: "local" });

await server.listen({ host: "0.0.0.0", port });

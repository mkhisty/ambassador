import { Spectrum } from "../messaging-integration/node_modules/spectrum-ts/dist/index.js";
import { imessage } from "../messaging-integration/node_modules/spectrum-ts/dist/providers/imessage/index.js";

const { PROJECT_ID, PROJECT_SECRET } = process.env;
if (!PROJECT_ID || !PROJECT_SECRET) {
  throw new Error("Set PROJECT_ID and PROJECT_SECRET in ../messaging-integration/.env");
}

const app = await Spectrum({
  projectId: PROJECT_ID,
  projectSecret: PROJECT_SECRET,
  providers: [imessage.config()],
});

console.log("Ambassador echo ready · Spectrum iMessage");
for await (const [, message] of app.messages) {
  if (message.direction === "inbound" && message.content.type === "text") {
    try {
      await message.reply(message.content.text);
    } catch (error) {
      console.error(`Echo failed: ${error.message}`);
    }
  }
}

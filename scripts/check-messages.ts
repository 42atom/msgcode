import { IMessageSDK } from "@photon-ai/imessage-kit";

const sdk = new IMessageSDK({ debug: false });

sdk.getMessages({ unreadOnly: true }).then(r => {
    const empty = r.messages.filter(m => !m.text?.trim());
    console.log("Empty messages:", empty.length);

    const byChat: Record<string, number> = {};
    empty.forEach(m => {
        const key = m.chatId || "NO_CHATID";
        byChat[key] = (byChat[key] || 0) + 1;
    });

    Object.entries(byChat).forEach(([chat, count]) => {
        console.log(`  ${chat.substring(0, 36)}... : ${count}`);
    });

    // 显示完整消息结构（前3条）
    console.log("\nSample structures:");
    empty.slice(0, 3).forEach((m, i) => {
        console.log(`Message ${i + 1}:`);
        console.log(`  id: ${m.id}`);
        console.log(`  chatId: ${m.chatId}`);
        console.log(`  text: ${m.text}`);
        console.log(`  hasAttachments: ${m.hasAttachments}`);
        console.log(`  isFromMe: ${m.isFromMe}`);
        console.log(`  date: ${m.date}`);
    });

    sdk.close();
}).catch(e => console.error(e));

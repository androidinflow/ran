require("dotenv").config();

console.log(`Node.js version: ${process.version}`);

const text = require("./src/config/lang/text.json");
const pb = require("./src/config/pocketbase");

const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN);

const axios = require("axios");
const cheerio = require("cheerio");

const { Markup } = require("telegraf");

// Define keyboards once at the top level
const KEYBOARDS = {
  home: Markup.keyboard([["🔍 یافتن چت", "🍆گیف👾"]]).resize(),
  waiting: Markup.keyboard([["🚪 خروج"]]).resize(),
  chat: Markup.keyboard([["🚪 خروج"], ["ℹ️ اطلاعات شریک"]]).resize(),
};

const ChatManager = require("./src/matchmaker");
let chatManager = new ChatManager(
  KEYBOARDS.home,
  KEYBOARDS.waiting,
  KEYBOARDS.chat,
  KEYBOARDS.home
);

chatManager.init();

// Rate limiting setup
const queue = [];
let isProcessing = false;
const RATE_LIMIT_DELAY = 2500; // 2.5 second delay between requests

async function processQueue() {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  const task = queue.shift();

  try {
    await task();
  } catch (error) {
    console.error("Error processing queue task:", error);
  } finally {
    isProcessing = false;
    // Wait for rate limit before processing next item
    setTimeout(() => processQueue(), RATE_LIMIT_DELAY);
  }
}

const handleUserStart = async (ctx) => {
  const { id, username = "Anonymous", first_name: name } = ctx.message.from;
  console.log(id, username, name, "sends start command");

  try {
    const existingUser = await chatManager.getUser(id);

    // Handle referral code if present and user is new
    const referralCode = ctx.startPayload;
    if (referralCode && !existingUser) {
      const [referrerId, referrerTid] = referralCode.split("-");

      if (referrerId === id.toString()) {
        await ctx.reply("شما نمیتوانید خودتان را به عنوان شریک ثبت کنید.", {
          reply_markup: KEYBOARDS.home.reply_markup,
        });
        return;
      }

      try {
        // Check if user was previously referred
        const referrer = await pb
          .collection("telegram_users")
          .getOne(referrerTid);
        if (!referrer.referrals.includes(id)) {
          const updatedReferrals = [...(referrer.referrals || []), id];
          await pb.collection("telegram_users").update(referrerTid, {
            username: referrer.username,
            name: referrer.name,
            points: referrer.points + 10,
            referrals: updatedReferrals,
          });

          // Save the referrer ID for the new user
          await chatManager.saveUser(id, username, name, referrerId);

          // Send notification to referrer
          await bot.telegram.sendMessage(
            referrerId,
            `🎉 تبریک! شما 10 امتیاز برای دعوت از کاربر جدید دریافت کردید!\n\nامتیاز فعلی شما: ${
              referrer.points + 10
            }`
          );
        }
      } catch (err) {
        console.error("Error updating referrer:", err);
      }
    } else {
      // Regular user save without referral
      await chatManager.saveUser(id, username, name);
    }

    // Send welcome message
    ctx.reply(text.START, chatManager.initialKeyboard);
  } catch (err) {
    console.error("Error in handleUserStart:", err);
    ctx.reply(text.ERROR, chatManager.initialKeyboard);
  }
};

const gifHandler = async (ctx) => {
  const userId = ctx.message.from.id;
  const { username = "Anonymous", first_name: name } = ctx.message.from;

  try {
    await chatManager.saveUser(userId, username, name);
    const user = await chatManager.getUser(userId);

    if (user.media_uses >= 9 && user.points === 0) {
      // Send a formatted message explaining the limit and referral system
      await ctx.replyWithHTML(
        `⚠️ <b>محدودیت استفاده</b>\n\n` +
          `😔 متأسفم، شما به محدودیت استفاده رسیده‌اید.\n\n` +
          `💡 برای دریافت امتیاز بیشتر می‌توانید دوستان خود را دعوت کنید!\n\n` +
          `🎁 <b>به ازای هر دعوت: ۱۰ امتیاز</b>\n\n` +
          `📲 لینک دعوت شما:`,
        {
          reply_markup: KEYBOARDS.home.reply_markup,
        }
      );

      // Send referral link with description that will be visible when forwarded
      await ctx.replyWithHTML(
        `🎭 سوراخی بات | Soorakhi Bot 🎭\n\n` +
          `🔞 بهترین ربات چت ناشناس و محتوای بزرگسالان\n` +
          `👥 چت ناشناس با کاربران تصادفی\n` +
          `🎯 محتوای اختصاصی و جذاب\n` +
          `✨ رابط کاربری ساده و کاربردی\n\n` +
          `👇 همین حالا عضو شوید 👇\n` +
          `https://t.me/soorakhi_bot?start=${userId}-${user.id}`,
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("📤 اشتراک‌گذاری لینک", "share_link")],
          ]),
          disable_web_page_preview: true,
        }
      );
      return;
    }

    const page = Math.floor(Math.random() * 2000) + 1;
    console.log(`Fetching page: https://pornogifs.net/page/${page}/`);
    const response = await axios.get(`https://pornogifs.net/page/${page}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const $ = cheerio.load(response.data);
    const gifs = $("img.cover-image")
      .map((i, el) => $(el).attr("data-src"))
      .get();

    if (gifs.length > 0) {
      const randomGif = gifs[Math.floor(Math.random() * gifs.length)];
      console.log(`Selected GIF URL: ${randomGif}`);

      try {
        // Download the GIF
        const gifResponse = await axios({
          method: "get",
          url: randomGif,
          responseType: "arraybuffer",
          timeout: 30000,
          headers: {
            Accept: "image/gif,image/*,*/*",
            "Accept-Encoding": "gzip, deflate, br",
            Referer: "https://pornogifs.net/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          maxContentLength: 10 * 1024 * 1024,
        });

        console.log("GIF downloaded, size:", gifResponse.data.length, "bytes");

        // Create buffer
        const buffer = Buffer.from(gifResponse.data);
        if (buffer.length === 0) {
          throw new Error("Downloaded buffer is empty");
        }

        console.log("Sending GIF to Telegram...");

        // Send using InputFile
        const sendGifTask = () =>
          ctx.telegram.sendAnimation(
            ctx.chat.id,
            {
              source: buffer,
              filename: "animation.gif",
            },
            {
              caption: `🔞 برای دریافت گیف های بیشتر عضو ربات شوید:\n@soorakhi_bot\n\n🎭 چت ناشناس و محتوای بزرگسالان\n👇 همین حالا عضو شوید 👇\nhttps://t.me/soorakhi_bot?start=${userId}-${user.id}`,
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("📤 اشتراک‌گذاری", "share_link")],
              ]),
            }
          );

        // Add to queue
        queue.push(sendGifTask);
        processQueue();

        console.log("GIF queued for sending");
        await chatManager.updateUser(user.id, user.media_uses + 1);
      } catch (downloadError) {
        console.error("Error downloading or sending GIF:", downloadError);
        if (downloadError.response?.error_code === 429) {
          const retryAfter =
            downloadError.response.parameters.retry_after || 30;
          await ctx.reply(
            `⚠️ لطفاً ${retryAfter} ثانیه صبر کنید و دوباره تلاش کنید.`,
            {
              reply_markup: KEYBOARDS.home.reply_markup,
            }
          );
        } else {
          throw new Error(`Failed to process GIF: ${downloadError.message}`);
        }
      }
    } else {
      await ctx.reply(
        "متأسفم، نتوانستم هیچ GIF پیدا کنیم. لطفاً بعداً دوباره تلاش کنید.",
        {
          reply_markup: KEYBOARDS.home.reply_markup,
        }
      );
    }
  } catch (error) {
    console.error("Error in gifHandler:", error);
    await ctx.reply(
      "متأسفم، خطایی در دریافت GIF رخ داد. لطفاً بعداً دوباره تلاش کنید.",
      {
        reply_markup: KEYBOARDS.home.reply_markup,
      }
    );
  }
};

bot.start(handleUserStart);
bot.hears("🍆گیف👾", gifHandler);

bot.hears("🔍 یافتن چت", (ctx) => {
  const userId = ctx.message.from.id;
  const { username = "Anonymous", first_name: name } = ctx.message.from;
  console.log(userId, username, name);
  chatManager.saveUser(userId, username, name);
  chatManager.findMatch(userId);
});

bot.hears("🚪 خروج", async (ctx) => {
  const userId = ctx.message.from.id;
  try {
    const room = await chatManager.getRoom(userId);
    if (room) {
      await ctx.reply("آیا مطمئن هستید که می‌خواهید گفتگو را پایان دهید؟", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ بله", callback_data: "confirm_exit" },
              { text: "❌ خیر", callback_data: "cancel_exit" },
            ],
          ],
        },
      });
    } else {
      chatManager.exitRoom(userId);
    }
  } catch (error) {
    console.error("Error in exit confirmation:", error);
    chatManager.exitRoom(userId);
  }
});

bot.hears("ℹ️ اطلاعات شریک", async (ctx) => {
  const userId = ctx.message.from.id;
  try {
    const partnerInfo = await chatManager.getPartnerInfo(userId);
    if (partnerInfo) {
      const formattedMessage = `
⭐️🌟 اطلاعات شریک چت شما ⭐️🌟
━━━━━━━━━━━━━━━━━━━━━
👤😊 نام: <b>${partnerInfo.name}</b>
━━━━━━━━━━━━━━━━━━━━━
امیدواریم گفتگوی خوبی داشته باشید! 🌟
      `;
      ctx.replyWithHTML(formattedMessage, { parse_mode: "HTML" });
    } else {
      ctx.reply(
        "😔 اوه، متأسفیم! ❌ شما در حال حاضر در چتی نیستید یا مشکلی در دریافت اطلاعات شریک پیش آمده است. لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید."
      );
    }
  } catch (error) {
    console.error("Error in Partner Info handler:", error);
    ctx.reply(
      "متأسفم، خطایی در دریافت اطلاعات شریک رخ داد. لطفاً بعداً دوباره تلاش کنید."
    );
  }
});

bot.on("text", (ctx) => {
  const userId = ctx.message.from.id;
  const { username = "Anonymous", first_name: name } = ctx.message.from;
  console.log(userId, username, name);
  chatManager.saveUser(userId, username, name);
  chatManager.connect(ctx.message.chat.id, ["text", ctx.message]);
});

bot.on(["document", "audio", "video", "voice", "photo", "sticker"], (ctx) => {
  const userId = ctx.message.from.id;
  const { username = "Anonymous", first_name: name } = ctx.message.from;
  console.log(userId, username, name);
  chatManager.saveUser(userId, username, name);
  const chatId = ctx.message.chat.id;
  let mediaFile =
    ctx.message.document ||
    ctx.message.audio ||
    ctx.message.video ||
    ctx.message.voice ||
    ctx.message.photo?.[ctx.message.photo.length - 1] ||
    ctx.message.sticker;

  if (ctx.message.photo) {
    mediaFile.file_name = "photo.jpg";
    mediaFile.mime_type = "image/jpeg";
  } else if (ctx.message.sticker) {
    mediaFile.file_name = "sticker.webp";
    mediaFile.mime_type = "image/webp";
  }

  mediaFile.file_name =
    mediaFile.file_name ||
    `file.${mediaFile.mime_type?.split("/")[1] || "unknown"}`;
  chatManager.connect(chatId, ["file", mediaFile]);
});

bot.on("web_app_data", (ctx) => {
  const data = ctx.webAppData.data;
  ctx.reply(`Received data from Web App: ${data}`);
  // Process the data as needed
});

bot.action("share_link", async (ctx) => {
  const userId = ctx.from.id;
  const user = await chatManager.getUser(userId);

  await ctx.replyWithHTML(
    `🎭 سوراخی بات | Soorakhi Bot 🎭\n\n` +
      `🔞 بهترین ربات چت ناشناس و محتوای بزرگسالان\n` +
      `👥 چت ناشناس با کاربران تصادفی\n` +
      `🎯 محتوای اختصاصی و جذاب\n` +
      `✨ رابط کاربری ساده و کاربردی\n\n` +
      `👇 همین حالا عضو شوید 👇\n` +
      `https://t.me/soorakhi_bot?start=${userId}-${user.id}`,
    {
      reply_markup: KEYBOARDS.home.reply_markup,
      disable_web_page_preview: true,
    }
  );

  await ctx.answerCbQuery("پیام دعوت آماده ارسال شد!");
});

// Action handlers for exit confirmation
bot.action("confirm_exit", async (ctx) => {
  const userId = ctx.from.id;
  try {
    await ctx.deleteMessage();
    await chatManager.exitRoom(userId);
    await ctx.answerCbQuery("گفتگو پایان یافت.");
  } catch (error) {
    console.error("Error in confirm exit:", error);
  }
});

bot.action("cancel_exit", async (ctx) => {
  try {
    await ctx.deleteMessage();
    await ctx.answerCbQuery("ادامه گفتگو.");
  } catch (error) {
    console.error("Error in cancel exit:", error);
  }
});

// Launch the bot
bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

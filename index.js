require("dotenv").config();

console.log(`Node.js version: ${process.version}`);

const text = require("./src/config/lang/text.json");
const pb = require("./src/config/pocketbase");

const express = require("express");
const app = express();
const port = process.env.PORT || 5000;

const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN);

const axios = require("axios");
const cheerio = require("cheerio");

const { Markup } = require("telegraf");

const homeKeyboard = Markup.keyboard([["🔍 یافتن چت", "🍆گیف👾"]]).resize();

const waitingKeyboard = Markup.keyboard([["🚪 خروج"]]).resize();

const chatKeyboard = Markup.keyboard([
  ["🚪 خروج"],
  ["ℹ️ اطلاعات شریک"],
]).resize();

const ChatManager = require("./src/matchmaker");
let chatManager = new ChatManager(
  homeKeyboard,
  waitingKeyboard,
  chatKeyboard,
  homeKeyboard
);

chatManager.init();

const handleUserStart = async (ctx) => {
  const { id, username = "Anonymous", first_name: name } = ctx.message.from;
  console.log(id, username, name);
  ctx.reply(text.START, chatManager.initialKeyboard);

  const referralCode = ctx.startPayload;
  if (referralCode) {
    console.log("referralCode", referralCode);
    const [referrerId, referrerTid] = referralCode.split("-");
    if (referrerId === id.toString()) {
      await ctx.reply("شما نمیتوانید خودتان را به عنوان شریک ثبت کنید.", {
        reply_markup: homeKeyboard.reply_markup,
      });
      return;
    }

    try {
      const existingUser = await chatManager.getUser(id);
      if (!existingUser) {
        console.log(
          `User ${id} doesn't exist in database. Giving points to the user`
        );

        // Save the new user first
        await chatManager.saveUser(id, username, name);

        // Now update the referrer's information
        const referrer = await pb
          .collection("telegram_users")
          .getOne(referrerTid);
        const updatedReferrals = [...(referrer.referrals || []), id];
        await pb.collection("telegram_users").update(referrerTid, {
          username: referrer.username, // Keep the original username
          name: referrer.name, // Keep the original name
          points: referrer.points + 10,
          referrals: updatedReferrals,
        });
      } else {
        console.log(`User ${id} already exists in database`);
      }
    } catch (err) {
      console.error("Error checking if user exists or updating referrer.", err);
    }
  }
};

const gifHandler = async (ctx) => {
  const userId = ctx.message.from.id;
  const { username = "Anonymous", first_name: name } = ctx.message.from;
  console.log(userId, username, name);

  try {
    await chatManager.saveUser(userId, username, name);
    console.log(`Media request from user ${userId}`);

    const user = await chatManager.getUser(userId);
    if (user.media_uses >= 9 && user.points == 0) {
      await ctx.reply(
        "متأسفم، شما بیش از حد استفاده کرده اید. لطفاً بعداً دوباره تلاش کنید.",
        {
          reply_markup: homeKeyboard.reply_markup,
        }
      );
      await ctx.reply(
        "this is your referral link to invite friends and earn points:",
        {
          reply_markup: homeKeyboard.reply_markup,
        }
      );
      await ctx.reply(`https://t.me/soorakhi_bot?start=${userId}-${user.id}`, {
        reply_markup: homeKeyboard.reply_markup,
      });
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
      await ctx.replyWithAnimation({ url: randomGif });
      await chatManager.updateUser(user.id, user.media_uses + 1);
      ctx.reply(`تعداد استفاده از محتوا: ${user.media_uses + 1}`);
      ctx.reply(`points: ${user.points}`);
    } else {
      await ctx.reply(
        "متأسفم، نتوانستم هیچ GIF پیدا کنیم. لطفاً بعداً دوباره تلاش کنید.",
        {
          reply_markup: homeKeyboard.reply_markup,
        }
      );
    }
  } catch (error) {
    console.error("Error fetching GIF:", error);
    await ctx.reply(
      "متأسفم، خطایی در دریافت GIF رخ داد. لطفاً بعداً دوباره تلاش کنید.",
      {
        reply_markup: homeKeyboard.reply_markup,
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

bot.hears("🚪 خروج", (ctx) => {
  const userId = ctx.message.from.id;
  chatManager.exitRoom(userId);
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

// Launch the bot
bot.launch();

// Set up the Express server
app.get("/", (req, res) => res.send("Hello World!"));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

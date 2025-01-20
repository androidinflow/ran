const { Telegram } = require("telegraf");
const tg = new Telegram(process.env.BOT_TOKEN);

const { Markup } = require("telegraf");

const text = require("./config/lang/text.json");

const pb = require("./config/pocketbase");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

class MatchMaker {
  constructor(initialKeyboard, searchingKeyboard, mainKeyboard) {
    this.initialKeyboard = initialKeyboard;
    this.searchingKeyboard = searchingKeyboard;
    this.mainKeyboard = mainKeyboard;
    this.intervalId = null; // To store the interval ID
    this.chattingKeyboard = Markup.keyboard([
      ["🚪 خروج"],
      ["ℹ️ اطلاعات شریک"],
    ]).resize();
  }

  async init() {
    const fetchQueues = async () => {
      try {
        const queues = await pb.collection("queues").getList(1, 2, {
          sort: "created",
        });
        if (queues.items.length === 2) {
          const newParticipants = queues.items.map((q) => q.user_id);
          for (const q of queues.items) {
            await pb.collection("queues").delete(q.id);
          }
          await this.createRoom(newParticipants);
        }
      } catch (err) {
        if (!err.isAbort) {
          console.error("Error in init:", err);
        }
      }
    };

    // Clear any existing interval before setting a new one
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.intervalId = setInterval(fetchQueues, 2000);
  }

  async createRoom(newParticipants) {
    try {
      const room = await pb.collection("rooms").create({
        participans: newParticipants,
      });

      for (const id of newParticipants) {
        const keyboard = Markup.keyboard([
          ["🚪 خروج"],
          ["ℹ️ اطلاعات شریک"],
        ]).resize(); // Only Exit button
        tg.sendMessage(id, `${text.CREATE_ROOM.SUCCESS_1}`, keyboard);
      }
    } catch (err) {
      console.error("Error creating room:", err);
    }
  }

  async updateUser(userID, newValue) {
    const data = {
      media_uses: newValue,
    };

    try {
      await pb.collection("telegram_users").update(userID, data);
    } catch (err) {
      console.error("Error updating user:", err);
    }
  }

  async findMatch(userID) {
    try {
      // Check if the user is already in a queue
      let existingQueue;
      try {
        existingQueue = await pb
          .collection("queues")
          .getFirstListItem(`user_id="${userID}"`);
      } catch (error) {
        if (error.status !== 404) {
          // Unexpected error when checking queue
          throw error;
        }
      }

      if (existingQueue) {
        tg.sendMessage(userID, text.FIND.WARNING_1);
        return;
      }

      // Check if the user is already in a room
      let existingRoom;
      try {
        existingRoom = await pb
          .collection("rooms")
          .getFirstListItem(`participans~"${userID}"`);
      } catch (error) {
        if (error.status !== 404) {
          // Unexpected error when checking rooms
          throw error;
        }
      }

      if (existingRoom) {
        tg.sendMessage(userID, text.FIND.WARNING_2);
        return;
      }

      // If user is not in queue or room, add them to the queue
      await pb.collection("queues").create({ user_id: userID });
      tg.sendMessage(userID, text.FIND.LOADING, this.searchingKeyboard);
    } catch (err) {
      console.error("Error in find method:", err);
      tg.sendMessage(userID, text.ERROR);
    }
  }

  async stopSearching(userID) {
    try {
      // First, check if the user is in a room
      let room;
      try {
        room = await pb
          .collection("rooms")
          .getFirstListItem(`participans~"${userID}"`);
      } catch (err) {
        if (err.status === 404) {
          // User is not in a room, check if they're in the queue
          console.log(`User ${userID} not found in any room, checking queue`);
        } else {
          throw err;
        }
      }

      if (room) {
        // If user is in a room, remove them and notify participants
        await pb.collection("rooms").delete(room.id);
        room.participans.forEach((id) => {
          if (userID === id) {
            tg.sendMessage(userID, text.STOP.SUCCESS_1, this.initialKeyboard);
          } else {
            tg.sendMessage(id, text.STOP.SUCCESS_2, this.initialKeyboard);
          }
        });
        return;
      }

      // If not in a room, check if user is in the queue
      let queue;
      try {
        queue = await pb
          .collection("queues")
          .getFirstListItem(`user_id="${userID}"`);
      } catch (err) {
        if (err.status === 404) {
          // User is not in the queue either
          tg.sendMessage(userID, text.STOP.WARNING_1, this.initialKeyboard);
          return;
        } else {
          throw err;
        }
      }

      if (queue) {
        // If user is in the queue, remove them
        await pb.collection("queues").delete(queue.id);
        tg.sendMessage(userID, text.STOP.SUCCESS_3, this.initialKeyboard);
      } else {
        // This shouldn't happen, but just in case
        tg.sendMessage(userID, text.STOP.WARNING_1, this.initialKeyboard);
      }
    } catch (err) {
      console.error("Error in stop:", err);
      tg.sendMessage(userID, text.ERROR, this.initialKeyboard);
    }
  }

  async exitRoom(userID) {
    try {
      // First, check if the user is in a queue
      let queue;
      try {
        queue = await pb
          .collection("queues")
          .getFirstListItem(`user_id="${userID}"`);
      } catch (err) {
        if (err.status === 404) {
          // User is not in queue, which is fine
          console.log(`User ${userID} not found in queue, checking if in room`);
        } else {
          throw err;
        }
      }

      if (queue) {
        // If user is in queue, remove them
        await pb.collection("queues").delete(queue.id);
        tg.sendMessage(userID, text.EXIT.SUCCESS_1, this.initialKeyboard);
        return;
      }

      // If not in queue, check if user is in a room
      let room;
      try {
        room = await pb
          .collection("rooms")
          .getFirstListItem(`participans~"${userID}"`);
      } catch (err) {
        if (err.status === 404) {
          // User is not in a room either
          tg.sendMessage(userID, text.EXIT.WARNING_1, this.initialKeyboard);
          return;
        } else {
          throw err;
        }
      }

      if (room) {
        // If user is in a room, remove them from the room
        await pb.collection("rooms").delete(room.id);
        room.participans.forEach((id) => {
          if (userID === id) {
            tg.sendMessage(userID, text.STOP.SUCCESS_1, this.initialKeyboard);
          } else {
            tg.sendMessage(id, text.STOP.SUCCESS_2, this.initialKeyboard);
          }
        });
      } else {
        // This shouldn't happen, but just in case
        tg.sendMessage(userID, text.EXIT.WARNING_1, this.initialKeyboard);
      }
    } catch (err) {
      console.error("Error in exit:", err);
      tg.sendMessage(userID, text.ERROR, this.initialKeyboard);
    }
  }

  async connect(userID, [type, data]) {
    try {
      const queue = await this.getQueueForUser(userID);
      if (queue) {
        await tg.sendMessage(userID, text.FIND.LOADING, {
          reply_markup: this.searchingKeyboard.reply_markup,
        });
        return;
      }

      const room = await this.getRoomForUser(userID);
      if (!room) {
        await tg.sendMessage(userID, text.CONNECT.WARNING_1, {
          reply_markup: this.mainKeyboard,
        });
        return;
      }

      const partnerID = this.getPartnerIDFromRoom(room, userID);
      const partner = await this.getUser(partnerID);
      const partnerName = partner?.name || partner?.username || "ناشناس";

      switch (type) {
        case "text":
          await this.handleTextMessage(userID, partnerID, data);
          break;
        case "file":
          await this.handleFileMessage(userID, partnerID, data);
          break;
        default:
          console.log(`Unsupported message type: ${type}`);
      }
    } catch (err) {
      console.error("Error in connect method:", err);
      await tg.sendMessage(userID, text.ERROR, {
        reply_markup: this.chattingKeyboard.reply_markup,
      });
    }
  }

  async getQueueForUser(userID) {
    try {
      return await pb
        .collection("queues")
        .getFirstListItem(`user_id="${userID}"`);
    } catch (err) {
      if (err.status !== 404) throw err;
      return null;
    }
  }

  async getRoomForUser(userID) {
    try {
      return await pb
        .collection("rooms")
        .getFirstListItem(`participans~"${userID}"`);
    } catch (err) {
      if (err.status !== 404) throw err;
      return null;
    }
  }

  getPartnerIDFromRoom(room, userID) {
    return room.participans.find((id) => id !== userID);
  }

  async handleTextMessage(senderID, receiverID, data) {
    const messageData = {
      sender_id: senderID.toString(),
      receiver_id: receiverID.toString(),
      type: "text",
      content: data.text,
    };

    try {
      await pb.collection("messages").create(messageData);
      console.log("Text message saved to PocketBase successfully");

      if (data.reply_to_message) {
        await this.#sendReply(
          receiverID,
          senderID,
          data.text,
          data,
          "sendMessage"
        );
      } else {
        await tg.sendMessage(receiverID, data.text, {
          reply_markup: this.chattingKeyboard,
        });
      }
    } catch (err) {
      console.error("Error saving or sending text message:", err);
    }
  }

  async handleFileMessage(senderID, receiverID, data) {
    try {
      if (data.mime_type === "image/webp") {
        await this.handleStickerMessage(receiverID, data);
      } else {
        await this.handleRegularFileMessage(senderID, receiverID, data);
      }
    } catch (err) {
      console.error("Error processing file:", err);
      this.#errorWhenRoomActive(err, senderID);
    }
  }

  async handleStickerMessage(receiverID, data) {
    await tg.sendSticker(receiverID, data.file_id);
    console.log("Sticker sent to partner successfully");
  }

  async handleRegularFileMessage(senderID, receiverID, data) {
    const fileLink = await tg.getFileLink(data.file_id);
    console.log(`File link: ${fileLink}`);
    const file = await uploadFileToPocketBase(
      fileLink,
      data.file_name,
      data.mime_type
    );

    const formData = {
      sender_id: senderID.toString(),
      receiver_id: receiverID.toString(),
      type: data.file_id.startsWith("AgAC") ? "photo" : "file",
      file_id: data.file_id,
      file_unique_id: data.file_unique_id,
      content: fileLink,
      file_name: data.file_name,
      mime_type: data.mime_type,
      caption: data.caption || "",
      files: [file],
    };

    await pb.collection("messages").create(formData);
    console.log("File saved to PocketBase successfully");

    if (data.file_id.startsWith("AgAC")) {
      await tg.sendPhoto(receiverID, data.file_id, {
        caption: data.caption || "",
      });
    } else {
      await tg.sendDocument(receiverID, data.file_id, {
        caption: data.caption || "",
      });
    }
    console.log("File sent to partner successfully");
  }

  #forceStop(userID) {
    Room.findOneAndDelete({ participans: userID }, (err, doc) => {
      if (err) {
        console.log(err);
      } else {
        if (doc) {
          let participans = doc.participans;
          participans.forEach((id) => {
            if (userID === id) {
              tg.sendMessage(userID, text.STOP.SUCCESS_2);
            }
          });
        }
      }
    });
  }

  #errorWhenRoomActive({ response, on }, userID) {
    console.log(response, on);
    switch (response.error_code) {
      case 403:
        this.#forceStop(userID);
        break;
      default:
        break;
    }
  }

  #sendReply(partnerID, userID, dataToSend, dataReply, type) {
    let {
      photo,
      video,
      message_id,
      from: { id },
    } = dataReply.reply_to_message;

    let number = photo || video ? 2 : 1;
    let replyToPlus = { reply_to_message_id: message_id + number };
    let replyToMinus = { reply_to_message_id: message_id - number };

    id == userID
      ? tg[type](partnerID, dataToSend, replyToPlus)
      : tg[type](partnerID, dataToSend, replyToMinus);
  }

  async getUser(userID) {
    try {
      const user = await pb
        .collection("telegram_users")
        .getFirstListItem(`telegram_id="${userID}"`);
      return user;
    } catch (err) {
      if (err.status === 404) {
        // User not found, which is expected for new users
        console.log("(from getUser function )user dont exist in database");
        return null;
      }
      console.error(`Error getting user ${userID}:`, err);
      throw err; // Rethrow the error to be handled by the caller
    }
  }

  async saveUser(userID, username, name) {
    try {
      const existingUser = await this.getUser(userID);
      if (existingUser) {
        console.log(`User ${userID} already exists in database just updating`);
        await pb.collection("telegram_users").update(existingUser.id, {
          username: username,
          name: name,
        });
        console.log(`User ${userID} updated successfully`);
        return existingUser.id;
      } else {
        console.log(`User ${userID} dont exist in database just creating`);
        const newUser = await pb.collection("telegram_users").create({
          telegram_id: userID.toString(),
          username: username,
          name: name,
          points: 0,
          media_uses: 0,
          referrals: [],
          referred_by: null,
        });
        console.log(`New user ${userID} created successfully`);
        return newUser.id;
      }
    } catch (err) {
      console.error("Error saving user:", err);
      return null;
    }
  }

  async getRoom(userID) {
    try {
      const room = await pb
        .collection("rooms")
        .getFirstListItem(`participans~"${userID}"`);
      return room;
    } catch (error) {
      if (error.status === 404) {
        // No room found, which is fine
        return null;
      }
      console.error("Error getting room:", error);
      return null;
    }
  }

  async getPartnerInfo(userID) {
    try {
      const room = await this.getRoom(userID);
      if (!room || !room.participans) return null;

      const partnerID = room.participans.find((id) => id !== userID);
      if (!partnerID) return null;

      const partner = await this.getUser(partnerID);
      if (!partner) return null;

      return {
        name: partner.name || "ناشناس",
        username: partner.username ? `@${partner.username}` : "ارائه نشده",
      };
    } catch (error) {
      console.error("Error getting partner info:", error);
      return null;
    }
  }
}

async function uploadFileToPocketBase(fileLink, fileName, fileType) {
  const response = await fetch(fileLink);
  const arrayBuffer = await response.arrayBuffer();
  const file = new File([arrayBuffer], fileName, { type: fileType });
  return file;
}

module.exports = MatchMaker;

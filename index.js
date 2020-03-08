const Telegraf = require("telegraf/telegraf");
const TelegrafI18n = require("telegraf-i18n");
const session = require("telegraf/session");
const updateLogger = require("telegraf-update-logger");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const Queue = require("bull");
const cyrillicToTranslit = require("cyrillic-to-translit-js");
const glob = require("glob");

const mainFile = process.env.DATA_FOLDER + "/_data.json";
const COMMANDS = {
  REMOVE: "delete",
  UPDATE: "update",
  FAV: "fav",
  UNFAV: "unfav"
};
let updatedPosts = [];

/* Config queue */
let postsQue = new Queue("posts queue");
postsQue.process(function(job) {
  return updatePost(job.data);
});
postsQue.on("completed", function(job, result) {
  if (job.data.post) {
    const post = job.data.post;
    if (post.from && post.from.id && post.forward_from_message_id) {
      updatedPosts.push(job.data.post.forward_from_message_id);
      bot.telegram.sendMessage(
        post.from.id,
        i18n.t(i18n.config.defaultLanguage, "USER.MESSAGE.POST_WAS_UPDATED", {
          id: post.forward_from_message_id
        }),
        {
          reply_to_message_id: post.message_id
        }
      );
    } else {
      updatedPosts.push(job.data.post.message_id);
    }
  }
});
postsQue.on("global:drained", function() {
  return updateFiles();
});

/* Config bot */
const bot = new Telegraf(process.env.BOT_TOKEN);
const i18n = new TelegrafI18n({
  directory: path.resolve(__dirname, "locales"),
  defaultLanguage: "ru",
  allowMissing: true, // Default true
  useSession: true
});

bot.use(updateLogger({ colors: true }));
bot.use(session());
bot.use(i18n.middleware());

/* Commands */
bot.start(({ reply, i18n }) => reply(i18n.t("BOT.WELCOME_MESSAGE")));
bot.help(({ reply, i18n }) => reply(i18n.t("BOT.HELP_MESSAGE")));
bot.command("myid", ({ from, reply, i18n }) => {
  reply(i18n.t("USER.MESSAGE.MYID", { id: from.id }));
});
bot.command(
  [COMMANDS.REMOVE, COMMANDS.UPDATE, COMMANDS.FAV, COMMANDS.UNFAV],
  ctx => {
    ctx.session.last_command = ctx.message.text.replace("/", "");
  }
);

bot.on("message", async ctx => {
  ctx.session.last_command = ctx.session.last_command || COMMANDS.UPDATE;
  if (ctx.session.last_command) {
    let last_command = ctx.session.last_command;
    let message = ctx.message;
    if (
      message.forward_from_chat &&
      message.forward_from_chat.id &&
      message.forward_from_chat.id == process.env.CHANNEL_ID
    ) {
      postsQue.add({
        post: message,
        command: ctx.session.last_command
      });
    } else {
      ctx.reply(ctx.i18n.t("USER.MESSAGE.DENY_REASON"));
    }
    ctx.session.last_command = undefined;
  }
});

bot.use(
  async ({
    channelPost,
    editedChannelPost,
    reply,
    telegram,
    deleteMessage,
    i18n
  }) => {
    let post = channelPost || editedChannelPost;
    if (post) {
      if (post.chat.id == process.env.CHANNEL_ID) {
        if (post.photo) {
          postsQue.add({ post: post });
        }
      }
      if (post.text == "/getid") {
        let admins = process.env.ADMIN_IDS.split(",");
        for (var id in admins) {
          telegram.sendMessage(
            admins[id],
            i18n.t("CHANNEL.MESSAGE.CHANNEL_ID", { id: post.chat.id })
          );
        }
        deleteMessage(post.message_id);
      }
    }
  }
);

/* Support functions */
function isAdmin(from_id) {
  let admins = process.env.ADMIN_IDS.split(",");
  for (var id in admins) {
    if (admins[id] == from_id) {
      return true;
    }
  }
  return false;
}

/* Producer functions */
async function updateFiles() {
  function writeFiles(file_mask, data) {
    data.sort((a, b) => b.id - a.id);
    const file_size = process.env.PAGE_SIZE;
    if (data.length < file_size) {
      let jsonData = JSON.stringify(data, null, 2);
      fs.writeFileSync(`${file_mask}-1.json`, jsonData);
    } else {
      let page = 1;
      while (page <= Math.ceil(data.length / file_size)) {
        fs.writeFileSync(
          `${file_mask}-${page}.json`,
          JSON.stringify(
            data.slice((page - 1) * file_size, page * file_size),
            null,
            2
          )
        );
        page++;
      }
    }
  }

  let result = false;
  if (fs.existsSync(mainFile)) {
    let rawdata = fs.readFileSync(mainFile);
    mainData = JSON.parse(rawdata);
    let tagDataUnordered = {};
    let tagSlugs = [];
    let acceptedData = [];
    for (let id in mainData) {
      let post = mainData[id];
      if (post.isRemoved) {
        continue;
      }
      post.slugs = [];
      for (let tag_id in post.tags) {
        let tagText = post.tags[tag_id];
        let tag = cyrillicToTranslit()
          .transform(tagText, "_")
          .toLowerCase();
        post.slugs.push(tag);
        if (!tagDataUnordered[tag]) {
          tagDataUnordered[tag] = [];
        }
        tagDataUnordered[tag].push(post);
        tagSlugs[tag] = tagText;
      }
      post.image = process.env.IMAGES_SLUG + post.image;
      acceptedData.push(post);
    }

    // Pages
    writeFiles(process.env.DATA_FOLDER + "/page", Object.values(acceptedData));
    // Tags: sort
    files = glob
      .sync(process.env.DATA_FOLDER + "/tags-*")
      .forEach(fs.unlinkSync);
    let tagData = {};
    Object.keys(tagDataUnordered)
      .sort()
      .forEach(function(key) {
        tagData[key] = tagDataUnordered[key];
        writeFiles(
          process.env.DATA_FOLDER + `/tags-${key}`,
          tagDataUnordered[key]
        );
      });
    // Tags: make main file
    let tagsForFile = [];
    for (let slug in tagSlugs) {
      tagsForFile.push({ title: tagSlugs[slug], slug: slug });
    }
    fs.writeFileSync(
      process.env.DATA_FOLDER + "/tags.json",
      JSON.stringify(tagsForFile, null, 2)
    );

    const run = process.env.RUN_COMMAND.replace(
      "%s",
      i18n.t(i18n.config.defaultLanguage, "BOT.COMMIT_MESSAGE", {
        date: new Date().toString().toLowerCase(),
        updated: updatedPosts.length,
        posts: updatedPosts.join(", ")
      })
    );
    updatedPosts = [];
    await exec(run);
    // Pages
    result = true;
  }
  return result;
}

async function updatePost({ post, command }) {
  async function downloadFile({ file_id, file_name }) {
    if (!fs.existsSync(process.env.IMAGES_FOLDER)) {
      fs.mkdirSync(process.env.IMAGES_FOLDER);
    }
    const link = await bot.telegram.getFileLink(file_id);
    const ext = path.extname(link);
    file_name = file_name + ext;
    const file = fs.createWriteStream(
      process.env.IMAGES_FOLDER + "/" + file_name
    );
    const request = https.get(link, function(response) {
      response.pipe(file);
    });
    return file_name;
  }

  function prepareData(post) {
    let caption = post.caption;
    if (!caption) {
      return { title: "", tags: "", url: "" };
    }
    let tags = [];
    let url = "";
    let title = caption.replace(/@(.*)|♡|☆/gi, "");
    for (var id in post.caption_entities) {
      let entity = post.caption_entities[id];
      switch (entity.type) {
        case "url":
          url = caption.slice(entity.offset, entity.length + entity.offset);
          title = title.replace(url, "");
          break;
        case "hashtag":
          let tag = caption.slice(
            entity.offset + 1,
            entity.length + entity.offset
          );
          tags.push(tag);
          title = title.replace(`#${tag}`, "");
          break;
      }
    }
    return {
      url: url,
      tags: tags,
      title: title.trim()
    };
  }

  command = command || COMMANDS.UPDATE;
  const message_id = post.forward_from_message_id || post.message_id;
  const date = post.forward_date || post.date;
  const edit_date = post.forward_from_message_id ? post.date : post.edit_date;
  if (!post || !post.photo) {
    return;
  }
  let mainData = {};
  if (!fs.existsSync(process.env.DATA_FOLDER)) {
    fs.mkdirSync(process.env.DATA_FOLDER);
  }
  if (fs.existsSync(mainFile)) {
    let rawdata = fs.readFileSync(mainFile);
    mainData = JSON.parse(rawdata);
  }
  let file_name = await downloadFile({
    file_id: post.photo.pop().file_id,
    file_name: message_id
  });
  const { title, tags, url } = prepareData(post);
  let isRemoved =
    command == COMMANDS.REMOVE
      ? true
      : (mainData[message_id] && mainData[message_id].isRemoved) || false;
  let isHighlighted =
    command == COMMANDS.FAV || command == COMMANDS.UNFAV
      ? command == COMMANDS.FAV
      : (mainData[message_id] && mainData[message_id].isHighlighted) || false;
  if (mainData[message_id] && mainData[message_id].caption === post.caption) {
    return true;
  }
  mainData[message_id] = {
    id: message_id,
    title: title,
    caption: post.caption || "",
    image: file_name,
    tags: tags,
    url: url,
    date: date,
    edit_date: edit_date,
    isHighlighted: isHighlighted,
    isRemoved: isRemoved
  };
  let data = JSON.stringify(mainData, null, 2);
  return fs.writeFileSync(mainFile, data);
}

module.exports = bot;

const {Scenes: {Stage, BaseScene}} = require("telegraf");
const {getMainKeyboard, getBackKeyboard} = require("./bot_keyboards.js");
const {GoogleSpreadsheet} = require("google-spreadsheet");
const creds = require("./rzk-com-ua-d1d3248b8410.json");
const Validator = require("validatorjs");
const {leave} = Stage;

const upload = new BaseScene("upload");

upload.enter((ctx) => {
  ctx.reply("Вставьте ссылку Google Sheet", getBackKeyboard);
});

upload.leave((ctx) => {
  ctx.reply("Menu", getMainKeyboard);
});

upload.hears("where", (ctx) => ctx.reply("You are in upload scene"));

upload.hears("back", leave());

// upload goods from sheet
upload.on("text", async (ctx) => {
  // parse url
  let sheetId;
  ctx.message.text.split("/").forEach((section) => {
    if (section.length === 44) {
      sheetId = section;
    }
  });
  if (sheetId) {
    // load goods
    const doc = new GoogleSpreadsheet(sheetId);
    try {
      await doc.useServiceAccountAuth(creds, "nadir@absemetov.org.ua");
      await doc.loadInfo(); // loads document properties and worksheets
      const sheet = doc.sheetsByIndex[0];
      ctx.replyWithMarkdown(`Load goods from sheet *${doc.title + " with " + (sheet.rowCount - 1)}* rows`);
      // read rows

      const perPage = 10;
      const rowCount = 10; // sheet.rowCount
      for (let i = 0; i < rowCount - 1; i += perPage) {
        console.log(`rowCount ${sheet.rowCount - 1}, limit: ${perPage}, offset: ${i}`);
        const rows = await sheet.getRows({limit: perPage, offset: i});
        const BreakException = {};
        try {
          rows.forEach((row) => {
            // validate data
            const item = {
              id: row.id.toLowerCase(),
              name: row.name,
              price: row.price ? Number(row.price.replace(",", ".")) : "",
            };
            const rulesItemRow = {
              id: "required|alpha_dash",
              name: "required|string",
              price: "required|numeric",
            };
            const validateItemRow = new Validator(item, rulesItemRow);
            if ( validateItemRow.fails() ) {
              console.log(row.id, row.name, row.price, row.group);
              // throw validateItemRow.errors.first("price");
              BreakException.rowIndex = row.rowIndex;
              BreakException.item = item;
              BreakException.desc = validateItemRow.errors.all();
              throw BreakException;
            }
          });
        } catch (error) {
          for (const [key, value] of Object.entries(error.desc)) {
            // console.log(`${key}: ${value}`);
            ctx.replyWithMarkdown(`Row *${error.rowIndex}* Error *${value}*`);
          }
          console.log(error);
        }
      }
    } catch (error) {
      ctx.replyWithMarkdown(`Sheet Error *${error}*`);
    }
  } else {
    ctx.replyWithMarkdown(`Sheet *${ctx.message.text}* not found, please enter valid url or sheet ID`);
  }
});

exports.upload = upload;
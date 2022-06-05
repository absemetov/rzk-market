const firebase = require("firebase-admin");
const {GoogleSpreadsheet} = require("google-spreadsheet");
const creds = require("./rzk-com-ua-d1d3248b8410.json");
const Validator = require("validatorjs");
const {google} = require("googleapis");
const CyrillicToTranslit = require("cyrillic-to-translit-js");
const {store, roundNumber, photoCheckUrl} = require("./bot_store_cart");
const cyrillicToTranslit = new CyrillicToTranslit();
const cyrillicToTranslitUk = new CyrillicToTranslit({preset: "uk"});
// upload from googleSheet
const uploadProducts = async (telegram, objectId, sheetId) => {
  const startTime = new Date();
  // for goods and catalogs
  const serverTimestamp = Math.floor(startTime / 1000);
  // per page default 500
  const perPage = 500;
  // Max upload goods
  const maxUploadGoods = 2000;
  // Catalogs set array
  const catalogsIsSet = new Map();
  // Products set array
  const productIsSet = new Set();
  // load sheet
  const doc = new GoogleSpreadsheet(sheetId);
  await doc.useServiceAccountAuth(creds, "nadir@absemetov.org.ua");
  // loads document properties and worksheets
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["products"];
  await telegram.sendMessage(94899148, `<b>Loading goods from ${doc.title}\n`+
  `Count rows: ${sheet.rowCount}</b>`,
  {parse_mode: "html"});
  let rowCount = sheet.rowCount;
  // array for save tags
  const catalogsTagsMap = new Map();
  // read rows
  for (let i = 1; i < rowCount; i += perPage) {
    // get rows data
    // use get cell because this method have numder formats
    await sheet.loadCells({
      startRowIndex: i, endRowIndex: i + perPage, startColumnIndex: 0, endColumnIndex: 8,
    });
    // write batch
    const batchArray = [];
    const batchGoods = firebase.firestore().batch();
    // catalog parallel batched writes
    let batchCatalogs = firebase.firestore().batch();
    let batchCatalogsCount = 0;
    // catalog tags batch
    const batchCatalogsTags = firebase.firestore().batch();
    // loop rows from SHEET
    for (let j = i; j < i + perPage && j < rowCount; j++) {
      const row = {
        ID: sheet.getCell(j, 0).value ? sheet.getCell(j, 0).value.toString() : sheet.getCell(j, 0).value,
        NAME: sheet.getCell(j, 1).value ? sheet.getCell(j, 1).value.trim() : sheet.getCell(j, 1).value,
        PURCHASE_PRICE: sheet.getCell(j, 2).value,
        PRICE: sheet.getCell(j, 3).value,
        CURRENCY: sheet.getCell(j, 4).value,
        UNIT: sheet.getCell(j, 5).value,
        GROUP: sheet.getCell(j, 6).value,
        TAGS: sheet.getCell(j, 7).value,
      };
      // stop scan if ID = "stop"
      if (row.ID === "stop") {
        rowCount = 0;
        break;
      }
      // validate group
      // generate catalogs array
      let groupArray = [];
      if (row.GROUP) {
        // generate Ids
        groupArray = row.GROUP.split("#");
        groupArray = groupArray.map((catalogName, index) => {
          let id = null;
          let parentId = null;
          let name = catalogName.trim();
          if (index !== 0) {
            // Parent exist
            const url = groupArray[index - 1].match(/(.+)\[([[a-zA-Z0-9-_]+)\]$/);
            if (url) {
              parentId = url[2].trim();
            } else {
              parentId = cyrillicToTranslitUk.transform(cyrillicToTranslit.transform(groupArray[index - 1].trim(), "-")).toLowerCase();
            }
          }
          const url = catalogName.match(/(.+)\[([[a-zA-Z0-9-_]+)\]$/);
          // url exist
          if (url) {
            name = url[1].trim();
            id = url[2].trim();
          } else {
            id = cyrillicToTranslitUk.transform(cyrillicToTranslit.transform(catalogName.trim(), "-")).toLowerCase();
          }
          return {
            id,
            name,
            parentId,
          };
        });
      }
      // generate tags array
      const tags = [];
      const tagsNames = [];
      if (row.TAGS) {
        // parse data
        const tagsArray = row.TAGS.split(",");
        tagsArray.forEach((tagName) => {
          const name = tagName.trim();
          const id = cyrillicToTranslitUk.transform(cyrillicToTranslit.transform(name, "-")).toLowerCase();
          tagsNames.push({
            id,
            name,
          });
          tags.push(id);
        });
      }
      // product data
      const product = {
        id: row.ID,
        name: row.NAME,
        purchasePrice: row.PURCHASE_PRICE ? roundNumber(row.PURCHASE_PRICE) : null,
        price: row.PRICE ? roundNumber(row.PRICE) : null,
        group: groupArray,
        tags: tags,
        currency: row.CURRENCY,
        unit: row.UNIT,
      };
      // required for arrays dont work
      const rulesProductRow = {
        "id": "required|alpha_dash|max:16",
        "name": "required|string",
        "purchasePrice": "numeric",
        "price": "required|numeric",
        "group.*.id": "alpha_dash|max:16",
        "tags.*": "alpha_dash|max:12",
        "currency": "required|in:USD,EUR,RUB,UAH",
        "unit": "required|in:м,шт",
      };
      const validateProductRow = new Validator(product, rulesProductRow);
      // check fails If product have ID Name else this commet etc...
      if (validateProductRow.fails() && (product.id && product.name)) {
        let errorRow = `In row *${j + 1}* Product ID *${product.id}*\n`;
        for (const [key, error] of Object.entries(validateProductRow.errors.all())) {
          errorRow += `Column *${key}* => *${error}* \n`;
        }
        throw new Error(errorRow);
      }
      // group is required!!!
      if (product.group.length === 0 && (product.id && product.name)) {
        throw new Error(`Group required in row ${j + 1}`);
      }
      // validate product
      if (validateProductRow.passes()) {
        // check limit goods
        if (productIsSet.size === maxUploadGoods) {
          throw new Error(`Limit *${maxUploadGoods}* goods!`);
        }
        // add products in batch
        // check id product is unic
        if (productIsSet.has(product.id)) {
          throw new Error(`Product ID *${product.id}* in row *${j + 1}* is exist`);
        } else {
          productIsSet.add(product.id);
        }
        const productRef = firebase.firestore().collection("objects").doc(objectId)
            .collection("products").doc(product.id);
        batchGoods.set(productRef, {
          "name": product.name,
          "purchasePrice": product.purchasePrice,
          "price": product.price,
          "currency": product.currency,
          "unit": product.unit,
          "orderNumber": productIsSet.size,
          "catalog": groupArray[groupArray.length - 1],
          "tags": tags,
          "tagsNames": tagsNames,
          "updatedAt": serverTimestamp,
        }, {merge: true});
        // save catalogs to batch
        for (const catalog of groupArray) {
          // check if catalog added to batch
          if (!catalogsIsSet.has(catalog.id)) {
            // set tags property only last catalog!!!
            if (groupArray[groupArray.length - 1].id === catalog.id) {
              catalogsTagsMap.set(catalog.id, new Map());
            }
            catalogsIsSet.set(catalog.id, {parentId: catalog.parentId});
            const catalogRef = firebase.firestore().collection("objects").doc(objectId)
                .collection("catalogs").doc(catalog.id);
            batchCatalogs.set(catalogRef, {
              "name": catalog.name,
              "parentId": catalog.parentId,
              "orderNumber": catalogsIsSet.size,
              "updatedAt": serverTimestamp,
              "tags": firebase.firestore.FieldValue.delete(),
            }, {merge: true});
            // check batch limit 500
            if (++batchCatalogsCount === perPage) {
              batchArray.push(batchCatalogs.commit());
              batchCatalogs = firebase.firestore().batch();
              batchCatalogsCount = 0;
            }
          }
          // Check if catalog moved
          if (catalogsIsSet.get(catalog.id).parentId !== catalog.parentId) {
            throw new Error(`Goods *${product.name}* in row *${j + 1}*,
Catalog *${catalog.name}* moved from  *${catalogsIsSet.get(catalog.id).parentId}* to  *${catalog.parentId}*, `);
          }
        }
        // add tags to last catalog
        if (tagsNames.length) {
          for (const tagsRow of tagsNames) {
            if (!catalogsTagsMap.get(groupArray[groupArray.length - 1].id).has(tagsRow.id)) {
              catalogsTagsMap.get(groupArray[groupArray.length - 1].id).set(tagsRow.id, tagsRow.name);
            }
            // if (!catalogsIsSet.get(groupArray[groupArray.length - 1].id).tags.has(tagsRow.id)) {
            //   const catalogRef = firebase.firestore().collection("objects").doc(objectId)
            //       .collection("catalogs").doc(groupArray[groupArray.length - 1].id);
            //   batchCatalogsTags.set(catalogRef, {
            //     "tags": firebase.firestore.FieldValue.arrayUnion({
            //       id: tagsRow.id,
            //       name: tagsRow.name,
            //     }),
            //   }, {merge: true});
            // }
            // // Add tags value to tmp Map
            // catalogsIsSet.get(groupArray[groupArray.length - 1].id).tags.add(tagsRow.id);
          }
        }
      }
    }
    // add bath goods to array
    batchArray.push(batchGoods.commit());
    // commit last batch catalog
    if (batchCatalogsCount > 0 && batchCatalogsCount !== perPage) {
      batchArray.push(batchCatalogs.commit());
    }
    // commit all bathes parallel with tags delete option
    await Promise.all(batchArray);
    // commit catalogs tags
    for (const catalog of catalogsTagsMap) {
      const catalogRef = firebase.firestore().collection("objects").doc(objectId)
          .collection("catalogs").doc(catalog[0]);
      batchCatalogsTags.set(catalogRef, {
        "tags": Array.from(catalog[1], ([id, name]) => ({id, name})),
      }, {merge: true});
    }
    await batchCatalogsTags.commit();
    // send done info
    await telegram.sendMessage(94899148, `<b>${i + perPage - 1} rows scaned from ${sheet.rowCount}</b>`,
        {parse_mode: "html"});
    // clear cache
    sheet.resetLocalCache(true);
  }
  // start delete trigger
  await store.createRecord(`objects/${objectId}`, {
    uploadProductsUpdatedAt: serverTimestamp,
  });
  // send notify
  const uploadTime = new Date() - startTime;
  await telegram.sendMessage(94899148, `<b>Data uploaded in ${Math.floor(uploadTime/1000)}s\n` +
      `Goods: ${productIsSet.size}\nCatalogs: ${catalogsIsSet.size}</b>`,
  {parse_mode: "html"});
};

// upload from googleSheet
const deleteProducts = async (telegram, objectId, updatedAt) => {
  // delete old Products
  const batchProductsDelete = firebase.firestore().batch();
  const productsDeleteSnapshot = await firebase.firestore().collection("objects").doc(objectId)
      .collection("products")
      .where("updatedAt", "!=", updatedAt).limit(500).get();
  productsDeleteSnapshot.forEach((doc) =>{
    batchProductsDelete.delete(doc.ref);
  });
  await batchProductsDelete.commit();
  if (productsDeleteSnapshot.size) {
    // await ctx.replyWithMarkdown(`*${productsDeleteSnapshot.size}* products deleted`);
    await telegram.sendMessage(94899148, `<b>${productsDeleteSnapshot.size} products deleted</b>`,
        {parse_mode: "html"});
  }
  // delete old catalogs
  const batchCatalogsDelete = firebase.firestore().batch();
  const catalogsDeleteSnapshot = await firebase.firestore().collection("objects").doc(objectId)
      .collection("catalogs")
      .where("updatedAt", "!=", updatedAt).limit(500).get();
  catalogsDeleteSnapshot.forEach((doc) =>{
    batchCatalogsDelete.delete(doc.ref);
  });
  await batchCatalogsDelete.commit();
  if (catalogsDeleteSnapshot.size) {
    // await ctx.replyWithMarkdown(`*${catalogsDeleteSnapshot.size}* catalogs deleted`);
    await telegram.sendMessage(94899148, `<b>${catalogsDeleteSnapshot.size} catalogs deleted</b>`,
        {parse_mode: "html"});
  }
};
// create object handler
const uploadActions = [];
const createObject = async (ctx, next) => {
  if (ctx.state.routeName === "upload") {
    const objectId = ctx.state.param;
    const todo = ctx.state.params.get("todo");
    const object = await store.findRecord(`objects/${objectId}`);
    let sheetId = "";
    if (todo === "updateObject" || todo === "uploadProducts") {
      sheetId = object.sheetId;
    } else {
      const sessionFire = await store.findRecord(`users/${ctx.from.id}`, "session");
      sheetId =sessionFire.sheetId;
    }
    try {
      // upload goods
      if (todo === "uploadProducts") {
        // await uploadProducts(ctx, object.id, sheetId);
        // await ctx.replyWithHTML(`Товары загружены ${object.name}, удачных продаж!\n`);
        // the current timestamp
        await ctx.replyWithHTML(`Начинаем загрузку товаров ${object.name}\n`);
        const uploadProductsStart = Math.floor(Date.now() / 1000);
        await store.createRecord(`objects/${objectId}`, {
          uploadProductsStart,
        });
        return;
      }
      // start upload
      const doc = new GoogleSpreadsheet(sheetId);
      await doc.useServiceAccountAuth(creds, "nadir@absemetov.org.ua");
      await doc.loadInfo(); // loads document properties and worksheets
      const sheet = doc.sheetsByTitle["info"]; // doc.sheetsById[listId];
      await sheet.loadCells("B1:B9"); // loads a range of cells
      const id = sheet.getCellByA1("B1").value;
      const name = sheet.getCellByA1("B2").value;
      const description = sheet.getCellByA1("B3").value;
      const phoneNumbers = sheet.getCellByA1("B4").value;
      const phoneArray = phoneNumbers && phoneNumbers.toString().split("#").map((phone) => {
        return `${process.env.BOT_PHONECODE}${phone.trim()}`;
      });
      const address = sheet.getCellByA1("B5").value;
      const USD = roundNumber(sheet.getCellByA1("B6").value);
      const EUR = roundNumber(sheet.getCellByA1("B7").value);
      const UAH = roundNumber(sheet.getCellByA1("B8").value);
      const RUB = roundNumber(sheet.getCellByA1("B9").value);
      let messageTxt = "";
      const objectCheck = {
        id,
        name,
        description,
        phoneArray,
        address,
        USD,
        EUR,
        UAH,
        RUB,
      };
      const rulesObject = {
        "id": "required|alpha_dash|max:9",
        "name": "required|string",
        "description": "required|string",
        "phoneArray": "required",
        "phoneArray.*": ["required", `regex:/${process.env.BOT_PHONEREGEXP}`],
        "address": "required|string",
        "USD": "required|numeric",
        "EUR": "required|numeric",
        "UAH": "required|numeric",
        "RUB": "required|numeric",
      };
      const validateObject = new Validator(objectCheck, rulesObject, {
        "regex": `The :attribute phone number is not in the format ${process.env.BOT_PHONETEMPLATE}`,
      });
      if (validateObject.fails()) {
        let errorRow = "";
        for (const [key, error] of Object.entries(validateObject.errors.all())) {
          errorRow += `field *${key}* => *${error}* \n`;
        }
        throw new Error(errorRow);
      }
      // actions
      if (todo === "createObject" || todo === "updateObject") {
        await store.createRecord(`objects/${objectId}`, {
          name,
          description,
          phoneArray,
          address,
          sheetId,
          USD,
          EUR,
          UAH,
          RUB,
        });
        if (object) {
          messageTxt = `Данные обновлены ${object.name} /objects`;
        } else {
          messageTxt = `Объект ${name} создан! /objects`;
        }
      }
      await ctx.replyWithHTML(messageTxt);
      // get object data
    } catch (error) {
      await ctx.replyWithMarkdown(`Sheet ${error}`);
    }
    await ctx.answerCbQuery();
  } else {
    return next();
  }
};
// show upload form when send link
const uploadForm = async (ctx, sheetId) => {
  const doc = new GoogleSpreadsheet(sheetId);
  try {
    // start upload
    await doc.useServiceAccountAuth(creds, "nadir@absemetov.org.ua");
    await doc.loadInfo(); // loads document properties and worksheets
    const sheet = doc.sheetsByTitle["info"]; // doc.sheetsById[listId];
    await sheet.loadCells("B1:B9"); // loads a range of cells
    const id = sheet.getCellByA1("B1").value;
    const name = sheet.getCellByA1("B2").value;
    const description = sheet.getCellByA1("B3").value;
    const phoneNumbers = sheet.getCellByA1("B4").value;
    const phoneArray = phoneNumbers && phoneNumbers.toString().split("#").map((phone) => {
      return `${process.env.BOT_PHONECODE}${phone.trim()}`;
    });
    const address = sheet.getCellByA1("B5").value;
    const USD = roundNumber(sheet.getCellByA1("B6").value);
    const EUR = roundNumber(sheet.getCellByA1("B7").value);
    const UAH = roundNumber(sheet.getCellByA1("B8").value);
    const RUB = roundNumber(sheet.getCellByA1("B9").value);
    let messageTxt = "";
    const object = {
      id,
      name,
      description,
      phoneArray,
      address,
      USD,
      EUR,
      UAH,
      RUB,
    };
    const rulesObject = {
      "id": "required|alpha_dash|max:9",
      "name": "required|string",
      "description": "required|string",
      "phoneArray": "required",
      "phoneArray.*": ["required", `regex:/${process.env.BOT_PHONEREGEXP}`],
      "address": "required|string",
      "USD": "required|numeric",
      "EUR": "required|numeric",
      "UAH": "required|numeric",
      "RUB": "required|numeric",
    };
    const validateObject = new Validator(object, rulesObject, {
      "regex": `The :attribute phone number is not in the format ${process.env.BOT_PHONETEMPLATE}`,
    });
    if (validateObject.fails()) {
      let errorRow = "";
      for (const [key, error] of Object.entries(validateObject.errors.all())) {
        errorRow += `field *${key}* => *${error}* \n`;
      }
      throw new Error(errorRow);
    }
    // message confirmed
    messageTxt = `Sheet name: <b>${doc.title}</b>\n` +
    `id: <b>${id}</b>\n` +
    `name: <b>${name}</b>\n` +
    `description: <b>${description}</b>\n` +
    `phoneArray: <b>${phoneArray.join()}</b>\n` +
    `address: <b>${address}</b>\n`;
    // check object
    const objectRzk = await store.findRecord(`objects/${id}`);
    const inlineKeyboardArray = [];
    let txtBtn = "";
    if (objectRzk) {
      txtBtn = "Обновить";
    } else {
      txtBtn = "Создать";
    }
    inlineKeyboardArray.push([{text: `${txtBtn} объект ${name}`, callback_data: `upload/${id}?todo=createObject`}]);
    await ctx.replyWithHTML(messageTxt, {
      reply_markup: {
        inline_keyboard: inlineKeyboardArray,
      }});
    // get object data
  } catch (error) {
    await ctx.replyWithMarkdown(`Sheet ${error}`);
  }
};
uploadActions.push(createObject);
// upload Merch Centere
// merch center
const uploadMerch = async (ctx, next) => {
  if (ctx.state.routeName === "uploadMerch") {
    const productId = ctx.state.param;
    const objectId = ctx.state.params.get("o");
    const object = await store.findRecord(`objects/${objectId}`);
    const product = await store.findRecord(`objects/${objectId}/products/${productId}`);
    let publicImgUrl = null;
    if (product.mainPhoto) {
      publicImgUrl = `photos/o/${objectId}/p/${product.id}/${product.mainPhoto}/2.jpg`;
    }
    const photoUrl = await photoCheckUrl(publicImgUrl);
    const content = google.content("v2.1");
    // add scope content in admin.google!!!
    const auth = new google.auth.JWT({
      keyFile: "./rzk-com-ua-d1d3248b8410.json",
      scopes: ["https://www.googleapis.com/auth/content"],
      subject: "nadir@absemetov.org.ua",
    });
    google.options({auth: auth});
    // Do the magic
    const res = await content.products.insert({
      merchantId: "120890507",
      resource: {
        "channel": "online",
        "contentLanguage": "uk",
        "offerId": product.id,
        "targetCountry": "UA",
        "title": product.name,
        "description": "Rzk.com.ua - Каждая вторая розетка в Украине будет куплена у нас!",
        "link": `https://rzk.com.ua/o/${objectId}/p/${product.id}`,
        "imageLink": photoUrl,
        "availability": "in stock",
        "condition": "new",
        "price": {
          "value": roundNumber(product.price * object[product.currency]),
          "currency": "UAH",
        },
      },
    });
    console.log(res.data);
    await ctx.answerCbQuery();
  } else {
    return next();
  }
};
uploadActions.push(uploadMerch);
exports.uploadForm = uploadForm;
exports.uploadActions = uploadActions;
exports.uploadProducts = uploadProducts;
exports.deleteProducts = deleteProducts;

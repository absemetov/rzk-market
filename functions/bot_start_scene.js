// const {Scenes: {BaseScene}} = require("telegraf");
const functions = require("firebase-functions");
const firebase = require("firebase-admin");
// const {getMainKeyboard} = require("./bot_keyboards.js");
// const start = new BaseScene("start");
// set default project
const botConfig = functions.config().env.bot;
const startActions = [];
// round to 2 decimals
const roundNumber = (num) => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};
// admin midleware
const isAdmin = (ctx, next) => {
  ctx.state.isAdmin = ctx.from.id === 94899148;
  return next();
};
// Parse callback data, add Cart instance
const parseUrl = (ctx, next) => {
  if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
    ctx.state.routeName = ctx.match[1];
    ctx.state.param = ctx.match[2];
    const args = ctx.match[3];
    // parse url params
    const params = new Map();
    if (args) {
      for (const paramsData of args.split("&")) {
        params.set(paramsData.split("=")[0], paramsData.split("=")[1]);
      }
    }
    ctx.state.params = params;
  }
  return next();
};
// cart instance
const cart = async (ctx, next) => {
  const cart = {
    userQuery: firebase.firestore().collection("users").doc(`${ctx.from.id}`),
    serverTimestamp: Math.floor(Date.now() / 1000),
    async getUserData() {
      const userRef = await this.userQuery.get();
      if (userRef.exists) {
        return {id: userRef.id, ...userRef.data()};
      }
      return null;
    },
    async add(product, qty) {
      qty = Number(qty);
      let productData = {};
      if (qty) {
        // add product to cart or edit
        if (typeof product == "object") {
          productData = {
            [product.id]: {
              name: product.name,
              price: product.price,
              unit: product.unit,
              qty: qty,
              createdAt: this.serverTimestamp,
            },
          };
        } else {
          productData = {
            [product]: {
              qty: qty,
            },
          };
        }
        await this.userQuery.set({
          cart: {
            products: productData,
          },
        }, {merge: true});
      } else {
        // delete product from cart
        await this.userQuery.set({
          cart: {
            products: {
              [typeof product == "object" ? product.id : product]: firebase.firestore.FieldValue.delete(),
            },
          },
        }, {merge: true});
      }
    },
    async products() {
      const products = [];
      const user = await this.getUserData();
      if (user) {
        if (user.cart && user.cart.products) {
          const cartProducts = user.cart.products;
          for (const [id, product] of Object.entries(cartProducts)) {
            products.push({id, ...product});
          }
        }
      }
      // sort products by createdAt
      products.sort(function(a, b) {
        return a.createdAt - b.createdAt;
      });
      return products;
    },
    async clear(withOrderData) {
      const clearData = {};
      if (withOrderData) {
        clearData.cart = {
          orderData: firebase.firestore.FieldValue.delete(),
          products: firebase.firestore.FieldValue.delete(),
        };
      } else {
        clearData.cart = {
          products: firebase.firestore.FieldValue.delete(),
        };
      }
      await this.userQuery.set({
        ...clearData,
      }, {merge: true});
    },
    async setWizardData(value) {
      await this.userQuery.set({
        cart: {
          wizardData: value,
        },
      }, {merge: true});
    },
    async getOrderData() {
      const user = await this.getUserData();
      if (user && user.cart.orderData) {
        return user.cart.orderData;
      }
      return {};
    },
    async getWizardData() {
      const user = await this.getUserData();
      if (user && user.cart.wizardData) {
        return user.cart.wizardData;
      }
      return {};
    },
    async setCartData(value) {
      await this.userQuery.set({
        cart: {
          ...value,
        },
      }, {merge: true});
    },
    async setUserName(value) {
      await this.userQuery.set({
        ...value,
      }, {merge: true});
    },
    async saveOrder(id, editRecipient) {
      // edit order
      if (id) {
        const order = firebase.firestore().collection("orders").doc(id);
        const user = await this.getUserData();
        // delete order products
        await order.set({
          products: firebase.firestore.FieldValue.delete(),
        }, {merge: true});
        // add new products from cart recipient
        if (editRecipient) {
          await order.set({
            ...user.cart.wizardData,
            updatedAt: this.serverTimestamp,
            products: user.cart.products,
          }, {merge: true});
        } else {
          await order.set({
            products: user.cart.products,
          }, {merge: true});
        }
      } else {
        // create new order
        // set counter
        await this.userQuery.set({
          orderCount: firebase.firestore.FieldValue.increment(1),
        }, {merge: true});
        const user = await this.getUserData();
        await firebase.firestore().collection("orders").add({
          userId: user.id,
          orderId: user.orderCount,
          fromBot: true,
          products: user.cart.products,
          createdAt: this.serverTimestamp,
          ...user.cart.wizardData,
        });
      }
      // clear cart delete orderId from cart
      await this.clear(id);
    },
  };
  ctx.state.cart = cart;
  return next();
};
// inline keyboard
const startKeyboard = [
  {text: "📁 Каталог", callback_data: "c"},
  {text: "🛒 Корзина", callback_data: "cart"},
];

const ordersKeyboard = [
  {text: "🧾 Заказы", callback_data: "orders"},
];

// start handler
const startHandler = async (ctx) => {
  const cartProductsArray = await ctx.state.cart.products();
  startKeyboard[1].text = "🛒 Корзина";
  if (cartProductsArray.length) {
    startKeyboard[1].text += ` (${cartProductsArray.length})`;
  }
  // ctx.reply("Выберите меню", getMainKeyboard);
  // ctx.reply("Welcome to Rzk.com.ru! Monobank rates /mono Rzk Catalog /catalog");
  // reply with photo necessary to show ptoduct
  await ctx.replyWithPhoto("https://picsum.photos/450/150/?random",
      {
        caption: `<b>${botConfig.name}</b>`,
        parse_mode: "html",
        reply_markup: {
          inline_keyboard: [startKeyboard, ordersKeyboard],
        },
      });
  // set commands
  await ctx.telegram.setMyCommands([
    {"command": "shop", "description": `${botConfig.name}`},
    {"command": "upload", "description": "Upload goods"},
    {"command": "mono", "description": "Monobank exchange rates "},
  ]);
  // ctx.scene.enter("catalog");
};
// main route
startActions.push(async (ctx, next) => {
  if (ctx.state.routeName === "start") {
    const cartProductsArray = await ctx.state.cart.products();
    startKeyboard[1].text = "🛒 Корзина";
    if (cartProductsArray.length) {
      startKeyboard[1].text += ` (${cartProductsArray.length})`;
    }
    await ctx.editMessageMedia({
      type: "photo",
      media: "https://picsum.photos/450/150/?random",
      caption: `<b>${botConfig.name}</b>`,
      parse_mode: "html",
    }, {
      reply_markup: {
        inline_keyboard: [startKeyboard, ordersKeyboard],
      },
    });
    await ctx.answerCbQuery();
  } else {
    return next();
  }
});

// start.hears("where", (ctx) => ctx.reply("You are in start scene"));

// exports.start = start;
exports.startActions = startActions;
exports.startHandler = startHandler;
exports.isAdmin = isAdmin;
exports.parseUrl = parseUrl;
exports.botConfig = botConfig;
exports.cart = cart;
exports.roundNumber = roundNumber;

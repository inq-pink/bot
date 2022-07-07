require('dotenv').config();

const telegraf = require('telegraf');
const puppeteer = require('puppeteer');
const adblock = require('@cliqz/adblocker-puppeteer');
const fetch = require('cross-fetch');

const PAGE_WIDTH = 1440;
const PAGE_HEIGHT = 900;
const SCROLL_BY = 0.8;
const PAGE_LIMIT = 4;
const PAGE_QUALITY = 30;

(async () => {
    const bot = new telegraf.Telegraf(process.env.BOT_TOKEN);
    const browser = await puppeteer.launch();
    const blocker = await adblock.PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch);

    const pages = {};

    bot.telegram.setMyCommands([{
        command: 'u',
        description: 'Load website by url',
    }, {
        command: 'q',
        description: 'Search google',
    }, {
        command: 'c',
        description: 'Click item',
    }, {
        command: 'i',
        description: 'Input text',
    }, {
        command: 'b',
        description: 'Navigate back',
    }, {
        command: 'f',
        description: 'Navigate forward',
    }]);

    bot.command('quit', (ctx) => {
        if (ctx.message.chat.type !== 'private')
            ctx.leaveChat();
    });

    bot.on('text', async (ctx) => {
        if (ctx.message.text === '/start') {
            ctx.reply(`Enter url`);
            return;
        }

        if (ctx.message.text.startsWith('/u')) {
            ctx.message.text = ctx.message.text.slice(2).trim();

            ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');

            let url = ctx.message.text;
            if (!url.startsWith('http'))
                url = 'http://' + url;

            if (!pages[ctx.chat.id]) {
                pages[ctx.chat.id] = await browser.newPage();
                pages[ctx.chat.id].setViewport({
                    width: PAGE_WIDTH,
                    height: PAGE_HEIGHT,
                });
                blocker.enableBlockingInPage(pages[ctx.chat.id]);
            }

            const page = pages[ctx.chat.id];

            try {
                await page.goto(url);

                const height = await page.evaluate(() =>
                    document.body.scrollHeight
                );
                const pages = Math.ceil(height / PAGE_HEIGHT * SCROLL_BY);
                const screenshots = Array(Math.min(pages, PAGE_LIMIT));

                for (let i = 0; i < screenshots.length; i++) {
                    screenshots[i] = await page.screenshot({
                        quality: PAGE_QUALITY,
                        type: 'webp',
                    });
                    await page.evaluate((scrollBy) =>
                        window.scrollBy({ top: scrollBy }),
                        Math.trunc(PAGE_HEIGHT * SCROLL_BY)
                    );
                }

                await ctx.replyWithMediaGroup(screenshots.map(screenshot => ({
                    type: 'photo',
                    media: {
                        source: screenshot,
                    },
                })));

                if (pages > PAGE_LIMIT) {
                    ctx.telegram.sendMessage(ctx.chat.id, `1 of ${Math.ceil(pages / PAGE_LIMIT)}`, {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: 'Scroll top', callback_data: 'load' },
                                    { text: 'Load more', callback_data: 'load' },
                                    { text: 'Scroll bottom', callback_data: 'load' },
                                ]
                            ],
                        },
                    });
                }
            } catch { }
        } else {
            ctx.reply('Sorry, this feature not implemented yet');
        }
    });

    bot.on('callback_query', (ctx) => {
        ctx.reply('Sorry, this feature not implemented yet');
    });

    bot.launch();

    process.once('SIGINT', () => {
        browser.close();
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        browser.close();
        bot.stop('SIGTERM');
    });
})();

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
    const state = {};

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

    bot.command('start', async (ctx) => {
        state[ctx.chat.id] = {
            status: await ctx.reply(`Enter command`),
        };
    });

    bot.command('u', async (ctx) => {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);

        ctx.message.text = ctx.message.text.slice(2).trim();

        await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');

        if (!pages[ctx.chat.id]) {
            pages[ctx.chat.id] = await browser.newPage();
            pages[ctx.chat.id].setViewport({
                width: PAGE_WIDTH,
                height: PAGE_HEIGHT,
            });
            blocker.enableBlockingInPage(pages[ctx.chat.id]);
            state[ctx.chat.id] = {
                status: await ctx.reply(`Enter command`),
            };
        }

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            state[ctx.chat.id].status.message_id,
            undefined,
            'Loading…',
        );

        const page = pages[ctx.chat.id];

        let url = ctx.message.text;
        if (!url.startsWith('http'))
            url = 'http://' + url;

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

            if (!state[ctx.chat.id].browser || screenshots.length > state[ctx.chat.id].browser.length) {
                if (state[ctx.chat.id].browser) {
                    for (let i = 0; i < state[ctx.chat.id].browser.length; i++) {
                        await ctx.telegram.deleteMessage(
                            ctx.chat.id,
                            state[ctx.chat.id].browser[i].message_id,
                        );
                    }
                    if (state[ctx.chat.id].control) {
                        await ctx.telegram.deleteMessage(
                            ctx.chat.id,
                            state[ctx.chat.id].control.message_id,
                        );
                        delete state[ctx.chat.id].control;
                    }
                }

                state[ctx.chat.id].browser = await ctx.replyWithMediaGroup(
                    screenshots.map(screenshot => ({
                        type: 'photo',
                        media: {
                            source: screenshot,
                        },
                    }))
                );
            } else {
                for (let i = 0; i < screenshots.length; i++) {
                    await ctx.telegram.editMessageMedia(
                        ctx.chat.id,
                        state[ctx.chat.id].browser[i].message_id,
                        undefined,
                        {
                            type: 'photo',
                            media: {
                                source: screenshots[i],
                            },
                        }
                    );
                }
                if (screenshots.length < state[ctx.chat.id].browser.length) {
                    for (let i = state[ctx.chat.id].browser.length - 1; i > screenshots.length - 1; i--) {
                        await ctx.telegram.deleteMessage(
                            ctx.chat.id,
                            state[ctx.chat.id].browser[i].message_id,
                        );
                    }
                }
            }

            if (pages > PAGE_LIMIT) {
                if (!state[ctx.chat.id].control) {
                    state[ctx.chat.id].control = await ctx.telegram.sendMessage(
                        ctx.chat.id,
                        `1 of ${Math.ceil(pages / PAGE_LIMIT)}`,
                        {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: 'To top', callback_data: 'top' },
                                        { text: 'Scroll up', callback_data: 'up' },
                                        { text: 'Scroll down', callback_data: 'down' },
                                        { text: 'To bottom', callback_data: 'bottom' },
                                    ]
                                ],
                            },
                        }
                    );
                } else {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        state[ctx.chat.id].control.message_id,
                        undefined,
                        `1 of ${Math.ceil(pages / PAGE_LIMIT)}`,
                        {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: 'To top', callback_data: 'top' },
                                        { text: 'Scroll up', callback_data: 'up' },
                                        { text: 'Scroll down', callback_data: 'down' },
                                        { text: 'To bottom', callback_data: 'bottom' },
                                    ]
                                ],
                            },
                        }
                    );
                }
            } else {
                if (state[ctx.chat.id].control) {
                    await ctx.telegram.deleteMessage(
                        ctx.chat.id,
                        state[ctx.chat.id].control.message_id,
                    );
                    delete state[ctx.chat.id].control;
                }
            }
        } catch (ex) {
            console.error(ex);
        } finally {

            await ctx.telegram.editMessageText(
                ctx.chat.id,
                state[ctx.chat.id].status.message_id,
                undefined,
                'Enter command',
            );
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

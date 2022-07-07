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

        await initCommandProcessing(ctx, state);

        const page = pages[ctx.chat.id];

        let url = ctx.message.text;
        if (!url.startsWith('http'))
            url = 'http://' + url;

        try {
            await page.goto(url);

            const { pages, screenshots } = await makeScreenshots(page);

            await renderBrowser(ctx, state, screenshots);
            await renderControl(ctx, state, pages);
        } catch (ex) {
            console.error(ex);
        } finally {
            await updateStatus(ctx, state, 'Enter command');
        }
    });

    bot.command('b', async (ctx) => {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);

        if (pages[ctx.chat.id]) {
            await initCommandProcessing(ctx, state);

            const page = pages[ctx.chat.id];

            try {
                await page.goBack();

                const { pages, screenshots } = await makeScreenshots(page);

                await renderBrowser(ctx, state, screenshots);
                await renderControl(ctx, state, pages);
            } catch (ex) {
                console.error(ex);
            } finally {
                await updateStatus(ctx, state, 'Enter command');
            }
        }
    });

    bot.command('f', async (ctx) => {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);

        if (pages[ctx.chat.id]) {
            await initCommandProcessing(ctx, state);

            const page = pages[ctx.chat.id];

            try {
                await page.goForward();

                const { pages, screenshots } = await makeScreenshots(page);

                await renderBrowser(ctx, state, screenshots);
                await renderControl(ctx, state, pages);
            } catch (ex) {
                console.error(ex);
            } finally {
                await updateStatus(ctx, state, 'Enter command');
            }
        }
    });

    bot.on('callback_query', async (ctx) => {
        if (pages[ctx.chat.id]) {
            await initCommandProcessing(ctx, state);

            const page = pages[ctx.chat.id];
            switch (ctx.callbackQuery.data) {
                case 'top':
                    await page.evaluate(() =>
                        window.scrollTo({ top: 0 }),
                    );
                    break;
                case 'up':
                    await page.evaluate((scrollBy) =>
                        window.scrollBy({ top: scrollBy }),
                        Math.trunc(-PAGE_LIMIT * PAGE_HEIGHT * SCROLL_BY),
                    );
                    break;
                case 'down':
                    await page.evaluate((scrollBy) =>
                        window.scrollBy({ top: scrollBy }),
                        Math.trunc(PAGE_LIMIT * PAGE_HEIGHT * SCROLL_BY),
                    );
                    break;
                case 'bottom':
                    await page.evaluate((scrollSpace) =>
                        window.scrollTo({ top: Math.max(0, document.body.scrollHeight - scrollSpace) }),
                        Math.trunc(PAGE_LIMIT * PAGE_HEIGHT * SCROLL_BY),
                    );
                    break;
            }

            try {
                const { pages, screenshots } = await makeScreenshots(page);

                await renderBrowser(ctx, state, screenshots);
                await renderControl(ctx, state, pages);
            } catch (ex) {
                console.error(ex);
            } finally {
                await updateStatus(ctx, state, 'Enter command');
            }
        }
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

async function initCommandProcessing(ctx, state) {
    await updateStatus(ctx, state, 'Loading…');
    await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');
}

async function makeScreenshots(page) {
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
            Math.trunc(PAGE_HEIGHT * SCROLL_BY),
        );
    }
    await page.evaluate((scrollBy) =>
        window.scrollBy({ top: scrollBy }),
        Math.trunc(-PAGE_LIMIT * PAGE_HEIGHT * SCROLL_BY),
    );

    return {
        pages,
        screenshots,
    };
}

async function updateStatus(ctx, state, message) {
    await ctx.telegram.editMessageText(
        ctx.chat.id,
        state[ctx.chat.id].status.message_id,
        undefined,
        message,
    );
}

async function renderBrowser(ctx, state, screenshots) {
    if (!state[ctx.chat.id].browser || screenshots.length > state[ctx.chat.id].browser.length) {
        await deleteBrowserIfExists(ctx, state);

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
        await deleteExtraScreenshots(ctx, state, screenshots);
    }
}

async function deleteExtraScreenshots(ctx, state, screenshots) {
    if (screenshots.length < state[ctx.chat.id].browser.length) {
        for (let i = state[ctx.chat.id].browser.length - 1; i > screenshots.length - 1; i--) {
            await ctx.telegram.deleteMessage(
                ctx.chat.id,
                state[ctx.chat.id].browser[i].message_id,
            );
        }
        state[ctx.chat.id].browser.splice(screenshots.length);
    }
}

async function deleteBrowserIfExists(ctx, state) {
    if (state[ctx.chat.id].browser) {
        for (let i = 0; i < state[ctx.chat.id].browser.length; i++) {
            await ctx.telegram.deleteMessage(
                ctx.chat.id,
                state[ctx.chat.id].browser[i].message_id,
            );
        }
        await deleteControlIfExists(ctx, state);
    }
}

async function renderControl(ctx, state, pages) {
    if (pages > PAGE_LIMIT) {
        await upsertControl(ctx, state, pages);
    } else {
        await deleteControlIfExists(ctx, state);
    }
}

async function upsertControl(ctx, state, pages) {
    if (!state[ctx.chat.id].control) {
        state[ctx.chat.id].control = await ctx.telegram.sendMessage(
            ctx.chat.id,
            ...getControl(pages),
        );
    } else {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            state[ctx.chat.id].control.message_id,
            undefined,
            ...getControl(pages),
        );
    }
}

function getControl(pages) {
    return [
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
    ]
}

async function deleteControlIfExists(ctx, state) {
    if (state[ctx.chat.id].control) {
        await ctx.telegram.deleteMessage(
            ctx.chat.id,
            state[ctx.chat.id].control.message_id,
        );
        delete state[ctx.chat.id].control;
    }
}

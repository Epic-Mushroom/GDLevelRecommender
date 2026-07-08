import mongoose from "mongoose";

import * as gddlAPI from "./gddl-api.js";
import {updateLevelID, Level} from "./server.js";
import {sleep} from "../utils.js";

const ENJ_COUNT_DIFFERENCE_PERCENT_THRESHOLD = 10.0; // only if the enj counts between db and actual differ by this percent will the level be updated

async function crawlPage(pageNum) {
    const response = await gddlAPI.getAPIResponse(["level", "search"], {
        limit: 25,
        page: pageNum,
        sort: "ID",
        sortDirection: "desc",
        minEnjoymentCount: 1
    });


    const promiseArr = [];
    for (const levelData of response.levels) {
        const existingLevelData = await Level.findOne({levelID: levelData.ID}, "ec");

        if (existingLevelData != null) {
            if ((levelData.EnjoymentCount - existingLevelData.ec) < levelData.EnjoymentCount * (ENJ_COUNT_DIFFERENCE_PERCENT_THRESHOLD / 100)) {
                console.log(`already up to date: ${levelData.ID}`);
                continue;

            } else {
                console.log(`updating with new info: ${levelData.ID} (actual EC: ${levelData.EnjoymentCount}, db EC: ${existingLevelData.ec})`);

            }

        } else {
            console.log(`inserting info for level id ${levelData.ID}`);

        }

        const baseData = {
            levelID: levelData.ID,
            n: levelData.Meta.Name,
            ec: levelData.EnjoymentCount,
            a: levelData.Meta.Publisher?.name,
            t: levelData.Rating,
            e: levelData.Enjoyment
        }

        promiseArr.push(updateLevelID(levelData.ID, baseData));
    }

    await Promise.allSettled(promiseArr);

    // true if there were still levels to scrape, false if none were found
    return response.levels.length !== 0;
}

async function crawl(startPage = 0) {
    for (let pageNum = startPage; pageNum < 199999; pageNum++) {
        if (!(await crawlPage(pageNum))) {
            break;
        }

        await sleep(1000);
    }

    await mongoose.disconnect();
    // eslint-disable-next-line no-undef
    process.exit(0);
}

await crawl(240);
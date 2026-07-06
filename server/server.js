import "dotenv/config";
import express from 'express';
import {connect, Schema, model} from 'mongoose';

import * as gddlAPI from "./gddl-api.js";

const app = express();
// eslint-disable-next-line no-undef
const PORT = process.env.PORT || 3001;

// eslint-disable-next-line no-undef
const MONGO_URI = process.env.MONGODB_URI;
connect(MONGO_URI).then(() => console.log("connected to database"));

const UserSchema = new Schema({
    userID: {type: Number, required: true, unique: true},
    ratings: [new Schema({ 
        l: Number, // level ID
        e: Number  // enjoyment rating
    }, {_id: false})]
});
const User = model("User", UserSchema);

const SkillSchema = new Schema({
    tagID: {type: Number, required: true},
    count: Number
}, {_id: false});

const LevelSchema = new Schema({
    levelID: {type: Number, required: true, unique: true},
    n: String, // level name
    ec: Number, // enjoyment count
    a: String, // level author
    t: Number, // tier rating
    e: Number, // enj rating
    sk: [SkillSchema], // list of skills
    sub: [[Number]] // 2d list of submitters' userIDs and corresp. enj ratings
});
const Level = model("Level", LevelSchema);

class GDDLError extends Error {
    constructor(status, message) {
        super(message);

        this.name = "GDDLError";
        this.status = status;
    }
}

async function getGDDLResponse(pathVariables, queryParams) {
    try {
        return await gddlAPI.getAPIResponse(pathVariables, queryParams);

    } catch (err) {
        if (err.name === "APIError") {
            throw new GDDLError(err.status, err.message);
        }

        throw err;
    }
}

async function updateUserID(userID) {
    const ratings = [];

    const collection = (response) => {
        for (const submission of response.submissions) {
            ratings.push({
                l: submission.Level.ID,
                e: submission.Enjoyment
            });
        }

        // console.log(`${ratings.length} submissions collected for id ${userID} so far`);
    }

    // find the max page first by making a request to the first page
    const response = await getGDDLResponse(["user", userID, "submissions"], {
        limit: gddlAPI.NUM_SUBMISSIONS_PER_USER_PAGE,
        page: 0,
        onlyIncomplete: false,
        pending: false
    });
    collection(response); // collect first page of submissions
    const maxPageNum = Math.ceil(response.total * 1.0 / gddlAPI.NUM_SUBMISSIONS_PER_USER_PAGE) - 1;

    for (let pageNum = 1; pageNum <= maxPageNum; pageNum++) {
        await getGDDLResponse(["user", userID, "submissions"], {
            limit: gddlAPI.NUM_SUBMISSIONS_PER_USER_PAGE,
            page: pageNum,
            onlyIncomplete: false,
            pending: false
        }).then(collection);
    }

    await User.findOneAndUpdate(
        {userID: userID},
        {userID: userID, ratings: ratings},
        {upsert: true}
    );

    console.log(`saved user ID ${userID} to db with ${ratings.length} ratings`);
    return {userID: userID, ratings: ratings};
}

async function updateLevelID(levelID) {
    const aggregateData = {
        levelID: 1,
        n: "Level", // level name
        ec: 0, // enjoyment count
        a: "-", // level author
        t: 39, // tier rating
        e: 10, // enj rating
        sk: [], // list of skills
        sub: [] // submitters' userIDs and corresp. enj ratings in a 2d array
    };

    // first call level/{levelID} to get Meta.Name (n), EnjoymentCount (ec), 
    // Meta.Publisher?.name (a), Rating (t) (ROUND THIS to 2dp), 
    // Enjoyment (e) (ALSO ROUND THIS TO 2dp)
    const levelBaseData = await getGDDLResponse(["level", levelID], {}); 
    aggregateData.levelID = levelID;
    aggregateData.n = levelBaseData.Meta.Name;
    aggregateData.ec = levelBaseData.EnjoymentCount;
    aggregateData.a = levelBaseData.Meta.Publisher?.name;
    aggregateData.t = Math.round(levelBaseData.Rating * 100) / 100;
    aggregateData.e = Math.round(levelBaseData.Enjoyment * 100) / 100;

    // then call level/{levelID}/submissions and COLLECT ONLY THE USERS IDS of the submitters
    const maxPageNum = Math.ceil(aggregateData.ec * 1.0 / gddlAPI.NUM_SUBMISSIONS_PER_LEVEL_PAGE) - 1;
    // math to get at most MAX_PAGES_TO_TRACK_PER_LEVEL pages but have the pages be evenly distributed
    // so you don't just collect high enjoyment ratings for popular levels
    const pageNumInc = Math.max(1, (maxPageNum + 1) * 1.0 / gddlAPI.MAX_PAGES_TO_TRACK_PER_LEVEL);

    for (let pageNumF = 0; pageNumF <= maxPageNum; pageNumF = pageNumF + pageNumInc) {
        const pageNum = Math.round(pageNumF);

        const submissionData = await getGDDLResponse(["level", levelID, "submissions"], {
            sort: "enjoyment",
            sortDirection: "desc", 
            twoPlayer: false,
            progressFilter: "victors",
            limit: gddlAPI.NUM_SUBMISSIONS_PER_LEVEL_PAGE,
            page: pageNum
        }); 

        aggregateData.sub.push(...((submissionData.submissions).map((submission) => [submission.UserID, submission.Enjoyment])));
    }

    // finally get tags/skills
    const skillsData = await gddlAPI.getLevelSkills(levelID);
    // convert the Map into a list of objects
    for (const [skillIDString, reactCount] of skillsData) {
        aggregateData.sk.push({tagID: parseInt(skillIDString), count: reactCount});
    }

    // update and return
    await Level.findOneAndUpdate(
        {levelID: levelID},
        aggregateData,
        {upsert: true}
    );

    console.log(`updated level data of level id ${levelID}`);
    return aggregateData;
}

function getErrorDetails(err) {
    const errorDetails = {status: 500, message: ""};

    if (err.name === "GDDLError") {
        if (err.status === 429) {
            errorDetails.message = "rate limited by gddl";

        } else if (err.status === 403) {
            errorDetails.message = "forbidden from making requests to gddl right now";

        } else if (err.status === 400) {
            errorDetails.message = "bad request made to gddl";

        } else {
            errorDetails.message = "error making request to gddl api";

        }

        errorDetails.status = err.status;
        errorDetails.message = `${err.status}: ${errorDetails.message}`;

    } else {
        console.error(`server error: ${err.message}`);
        errorDetails.message = `non-gddl related error: ${err.message}`;

    }

    return errorDetails;
}

app.get('/api/user', async (req, res) => {
    try {
        let queryObject = {};

        if (req.query.userIDs != null) {
            const ids = req.query.userIDs.split(",").map(id => parseInt(id));

            queryObject = {userID: {$in: ids}};
        }

        const users = await User.find(queryObject, '-_id');
        res.json(users);

    } catch (err) {
        const errorDetails = getErrorDetails(err);

        res.status(errorDetails.status).json({error: errorDetails.message});
    }
});
app.get('/api/user/:userID', async (req, res) => {
    const id = parseInt(req.params.userID);

    try {
        let forceUpdate = false;

        if (req.query.forceUpdate != null) {
            forceUpdate = req.query.forceUpdate.trim().toLowerCase() === "true";
        }
        
        let user = await User.findOne({userID: id}, '-_id');

        if (user == null || forceUpdate) {
            user = await updateUserID(id);
        }

        res.json(user);

    } catch (err) {
        const errorDetails = getErrorDetails(err);

        res.status(errorDetails.status).json({error: errorDetails.message});
    }
});
app.get('/api/level/:levelID', async (req, res) => {
    const id = parseInt(req.params.levelID);

    try {
        let forceUpdate = false;

        if (req.query.forceUpdate != null) {
            forceUpdate = req.query.forceUpdate.trim().toLowerCase() === "true";
        }

        let level = await Level.findOne({levelID: id}, '-_id');

        if (level == null || forceUpdate) {
            level = await updateLevelID(id);
        }

        res.json(level);

    } catch (err) {
        const errorDetails = getErrorDetails(err);

        res.status(errorDetails.status).json({error: errorDetails.message});
    }
});

app.listen(PORT, () => console.log(`server running on port ${PORT}`));
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
    ratings: [{ 
        l: Number, // level ID
        e: Number  // enjoyment rating
    }]
});
const User = model("User", UserSchema);

const LevelSchema = new Schema({
    levelID: {type: Number, required: true, unique: true},
    n: String, // level name
    a: String, // level author
    t: Number, // tier rating
    e: Number // enj rating
    // skills later
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
        const response = await gddlAPI.getAPIResponse(pathVariables, queryParams);

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

        console.log(`${ratings.length} submissions collected for id ${userID} so far`);
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
            page: 0,
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
        errorDetails.message = `non-gddl related error: ${err.message}`;

    }

    return errorDetails;
}

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'userID ratings -_id');
        res.json(users);

    } catch (err) {
        res.status(500).json({error: "failed to fetch data"});

    }
});
app.get('/api/users/:userID', async (req, res) => {
    const id = parseInt(req.params.userID);

    try {
        let user = await User.findOne({userID: id}, 'userID ratings -_id');

        if (user == null) {
            user = await updateUserID(id);
        }

        res.json(user);

    } catch (err) {
        const errorDetails = getErrorDetails(err);

        res.status(errorDetails.status).json({error: errorDetails.message});
    }
});

app.listen(PORT, () => console.log(`server running on port ${PORT}`));
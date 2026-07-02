const DEFAULT_USER_ID = 92;
const DEFAULT_USERNAME = "EpicMushroom";

const BASE_COMPAT = 150;

export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max) + 1;
    return Math.floor(Math.random() * (max - min) + min);
}

class EnjoymentProfile {
    constructor(userID = 92, username = DEFAULT_USERNAME, isOther = false) {
        this.userID = 92;
        this.username = username;
        this.isOther = isOther;

        this.enjMap = new Map();
    }

    setUsername(username) {
        this.username = username;
    }

    setUserID(ID) {
        this.userID = ID;
    }

    addEnjRating(levelID, enjoyment) {
        if (enjoyment == null || (enjoyment < 0 || enjoyment > 10)) {
            return null;
        }

        this.enjMap.set(levelID, enjoyment);

        return [levelID, enjoyment];
    }

    clearEnjRatings() {
        this.enjMap.clear();
    }

    isLevelCompleted(levelID) {
        return this.enjMap.has(levelID);
    }

    getCompatThreshold() {
        
    }
}

class DataManager {
    constructor() {
        this.reset();
    }

    reset() {
        this.userEnjProfile = new EnjoymentProfile();
        /**
         * Other users' ID's mapped to their own enjoyment profiles
         * @type {Map<number, EnjoymentProfile>}
         */
        this.otherUserEnjProfileMap = new Map();
    }

    addUserEnjRating(levelID, enjoyment) {
        return this.userEnjProfile.addEnjRating(levelID, enjoyment);
    }

    addOtherUserEnjRating(otherUserID, otherUsername, levelID, enjoyment) {
        if (this.userEnjProfile.isLevelCompleted(levelID)) {
            return null;
        }

        if (!this.otherUserEnjProfileMap.has(otherUserID)) {
            this.otherUserEnjProfileMap.set(otherUserID, new EnjoymentProfile(otherUserID, otherUsername));
        }

        this.otherUserEnjProfileMap.get(otherUserID).addEnjRating(levelID, enjoyment);
    }
}

export const dataManager = new DataManager();
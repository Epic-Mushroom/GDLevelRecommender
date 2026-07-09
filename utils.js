const MAX_BATCH_REQUEST_SIZE = 13;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 
 * @param {string} string 
 * @param {number} defaultValue
 * @param {number} min 
 * @param {number} max 
 * @returns 
 */
export function purifyInt(string, defaultValue = 0, min = -Infinity, max = Infinity) {
    let float = parseFloat(string);
    float = Math.max(Math.min(float, max), min);
    return (isNaN(float) ? defaultValue : Math.round(float));
}

export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max) + 1;
    return Math.floor(Math.random() * (max - min) + min);
}

/**
 * gets the first n elements of an iterable sorted by a function (without actually sorting the iterable)
 * @template T
 * @param {Iterable<T>} iterable 
 * @param {number} n
 * @param {function(T): number} func a function that is called on each element to use the result as the basis for sorting
 * @returns {T[]}
 */
export function getNBest(iterable, n, func = (a) => a) {
    const resultArr = [];
    let largestElem = null;
    let largestBasis = null;
    
    for (const element of iterable) {
        const basis = func(element);

        if (resultArr.length < n || (largestElem != null && basis < largestBasis)) {
            resultArr.push(element);

            if (largestElem == null) {
                largestElem = element; 
                largestBasis = func(element);
                continue;
            }

            // kick out overflowing element
            if (resultArr.length > n) {
                for (let i = 0; i < resultArr.length; i++) {
                    if (func(resultArr[i]) >= largestBasis) {
                        resultArr.splice(i, 1);
                        break;
                    }
                }
            }

            // recalculate largestBasisInSet and largestElemInSet
            largestBasis = null;
            largestElem = null;
            for (const setElem of resultArr) {
                const thisBasis = func(setElem);
                if (largestBasis == null || thisBasis > largestBasis) {
                    largestBasis = thisBasis;
                    largestElem = setElem;
                }
            }
        }
    }

    resultArr.sort((a, b) => func(a) - func(b));

    return resultArr;
}

export function reverseMap(map) {
    return new Map(Array.from(map, ([key, val]) => [val, key]));
}

/**
 * 
 * @param {Array} arr 
 * @param {number} chunkSize 
 * @returns 
 */
export function chunkArray(arr, chunkSize) {
    const chunks = [];

    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }

    return chunks;
}

/**
 * measures the time elapsed of an awaited async function call
 * @param {async} operation async function
 * @param {Array} paramsArr array of parameters
 * @param {string} name 
 */
export async function measureTime(operation, paramsArr, name = null) {
    const timestamp = Date.now();
    const operationResult = await operation(...paramsArr);
    const timeElapsed = Date.now() - timestamp;

    console.log(`time elapsed for ${(name == null) ? "operation" : name}: ${timeElapsed}ms`);
    return operationResult;
}

/**
 * does not mutate the original array
 * @param {[*, number][]} arr2D 
 */
export function normalize2DArr(arr2D, magnitude) {
    if (arr2D == null) {
        return arr2D;
    }

    const sumOfSquaredWeights = arr2D.reduce((sum, keyValPair) => sum + keyValPair[1] ** 2, 0);
    const oldMagnitude = Math.sqrt(sumOfSquaredWeights);
    const ratio = magnitude / oldMagnitude;

    return arr2D.map(([key, val]) => [key, val * ratio]);
}

/**
 * "inverts" a 2D array as a vector, where relatively high values will become relatively low ones and vice versa
 * does not mutate the original array
 * @param {[*, number][]} arr2D 
 */
export function invert2DArr(arr2D) {
    const rangeEnd = Math.max(...arr2D.map(keyValPair => keyValPair[1]));
    const rangeStart = Math.min(...arr2D.map(keyValPair => keyValPair[1]));

    return arr2D.map(([key, val]) => [key, rangeEnd + rangeStart - val]);
}

/**
 * adjusts a value that is within oldRange so that it fits the same way in newRange
 * for example, adjusting the value 5 from oldRange [0, 10] to newRange [1, 2] will return 1.5
 * @param {number} value 
 * @param {Array<number>} oldRange 
 * @param {Array<number>} newRange 
 */
export function adjustToRange(value, oldRange, newRange) {
    if (oldRange.length !== 2 || newRange.length !== 2) {
        throw new Error("ranges must have length 2");
    }

    const oldRangeLength = oldRange[1] - oldRange[0];
    const newRangeLength = newRange[1] - newRange[0];

    const rangeProportion = (oldRangeLength === 0) ? 1 : ((value - oldRange[0]) * 1.0 / oldRangeLength);
    return newRange[0] + rangeProportion * newRangeLength;
}

/**
 * both arrays must have the same size
 * @param {Array<number>} values1 
 * @param {Array<number>} values2 
 * @returns 
 */
export function pearsonSimilarity(values1, values2) {
    const n = values1.length;
    if (n < 2 || n !== values2.length) {
        return 0; 
    }

    const avg1 = values1.reduce((sum, val) => sum + val, 0) / n;
    const avg2 = values2.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let sumOfSquares1 = 0;
    let sumOfSquares2 = 0;

    for (let i = 0; i < n; i++) {
        const difference1 = values1[i] - avg1;
        const difference2 = values2[i] - avg2;

        numerator += difference1 * difference2;
        sumOfSquares1 += difference1 * difference1;
        sumOfSquares2 += difference2 * difference2;
    }

    // need to check if any of the sums are 0, or else we would divide by 0
    if (sumOfSquares1 === 0 || sumOfSquares2 === 0) {
        return 0;
    } 

    return numerator * 1.0 / Math.sqrt(sumOfSquares1 * sumOfSquares2);
}

/**
 * calculates cosine similarity between two 2D arrays as vectors
 * @param {[*, number][]} arr2D1 
 * @param {[*, number][]} arr2D2 
 */
export function cosineSimilarity(arr2D1, arr2D2, magnitude1, magnitude2) {
    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }

    const map1 = new Map(arr2D1);
    const map2 = new Map(arr2D2);

    let dotProduct = 0;
    for (const key of map1.keys()) {
        const val1 = (map1.get(key) == null) ? 0 : map1.get(key);
        const val2 = (map2.get(key) == null) ? 0 : map2.get(key);

        dotProduct += val1 * val2;
    }

    return dotProduct * 1.0 / (magnitude1 * magnitude2);
}

/**
 * gives a 2D array a score depending on whether or not the values (index 1 elements) have a higher ratio than
 * the respective values in the rubric array
 * @param {*} arr2D 
 * @param {*} rubricArr2D 
 * @param {*} maxNumRubricItems how many items from the rubric to consider, will pick the highest ratio rubric items
 * @param {*} leniencyRange if a value's ratio from the input is less than the corresponding rubric ratio but falls within
 *                          the leniency range, will not be penalized
 */
export function scoreVector(arr2D, rubricArr2D, maxNumRubricItems, leniencyRange = 0.2) {
    // ratio is out of the input array's highest value
    const arrRangeEnd = Math.max(...arr2D.map(keyValPair => keyValPair[1]));
    const arrRatios2D = arr2D.map(([key, val]) => [key, adjustToRange(val, [0, arrRangeEnd], [0.0, 1.0])]);
    const arrRatiosMap = new Map(arrRatios2D);

    // ratio is out of the sum of values
    const rubricRangeSum = rubricArr2D.map(keyValPair => keyValPair[1]).reduce((sum, val) => sum + val, 0);
    const rubricRatios2D = rubricArr2D.map(([key, val]) => [key, adjustToRange(val, [0, rubricRangeSum], [0.0, 1.0])]);

    const filteredRubricRatios2D = getNBest(rubricRatios2D, maxNumRubricItems, ([key, val]) => -val);

    const [minScore, maxScore] = [-maxNumRubricItems, maxNumRubricItems];

    let score = 0;
    for (const [key, rubricRatio] of filteredRubricRatios2D) {
        const arrRatio = arrRatiosMap.get(key) || 0;

        if (arrRatio >= rubricRatio) {
            score += 1;

        } else if (arrRatio < rubricRatio - leniencyRange) {
            score -= 1;
            
        }
    }

    return adjustToRange(score, [minScore, maxScore], [0, 1]);

}
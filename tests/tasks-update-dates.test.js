process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn(() => Promise.resolve()) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({}));
jest.mock('../Modules/Tasks/helpers/taskMongo/recordCompletion.js', () => ({}));
jest.mock('../Modules/Tasks/helpers/completionStore.js', () => ({}));
jest.mock('../Modules/Tasks/helpers/importMark', () => ({}));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({}));
jest.mock('../Modules/Tasks/helpers/helper.js', () => ({}));
jest.mock('../Modules/serviceFunction', () => ({}));
jest.mock('../Modules/Sprints/controller', () => ({}));
jest.mock('../Modules/notification-count/controller', () => ({}));
jest.mock('../Modules/Comments/controller', () => ({}));
jest.mock('../Modules/MainChats/controller', () => ({}));
jest.mock('../Modules/Auth/helper', () => ({}));
jest.mock('../Modules/Company/eventController.js', () => ({}));
jest.mock('../Modules/LogTime/controllerV2.js', () => ({}));
jest.mock('../utils/commonFunctions.js', () => ({}));
jest.mock('../common-storage/common-server.js', () => ({}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const { HandleHistory } = require('../Modules/Tasks/helpers/mongo_helper');
const basic = require('../Modules/Tasks/helpers/taskMongo/updateBasic');

const COMPANY = 'c1';
const TASK = new mongoose.Types.ObjectId();
const PROJECT = { CompanyId: COMPANY, _id: new mongoose.Types.ObjectId(), ProjectName: 'P' };
const TASK_DATA = { _id: TASK, sprintId: 's1' };
const USER = { Employee_Name: 'Max' };
const STORED = { startDate: new Date('2026-09-05'), DueDate: new Date('2026-09-10') };
const DATE_ORDER = 'Start date must be on or before the due date';

const run = (firebaseObj) => basic.updateDates({ firebaseObj, projectData: PROJECT, taskData: TASK_DATA, userData: USER });
const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter(([, , m]) => m === method);
const updateFilter = () => callsOf('findOneAndUpdate')[0][1].data[0];

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => {
        if (method === 'findOneAndUpdate') return { _id: TASK, ...STORED };
        if (method === 'findOne') return { _id: TASK, ...STORED };
        return null;
    });
});

describe('updateDates', () => {
    test('writes both dates in one atomic update and emits once', async () => {
        const result = await run({ startDate: '2026-09-02T00:00:00.000Z', DueDate: '2026-09-04T00:00:00.000Z' });
        expect(result).toEqual({ status: true, statusText: 'Dates updated successfully' });
        const [companyId, query] = callsOf('findOneAndUpdate')[0];
        expect(companyId).toBe(COMPANY);
        expect(query.data[1]).toEqual({
            $set: { startDate: new Date('2026-09-02T00:00:00.000Z'), DueDate: new Date('2026-09-04T00:00:00.000Z') },
        });
        expect(Object.keys(updateFilter())).toEqual(['_id']);
        expect(socketEmitter.emit).toHaveBeenCalledTimes(1);
        expect(HandleHistory).toHaveBeenCalledTimes(1);
    });

    test('equal start and due dates are accepted', async () => {
        const result = await run({ startDate: '2026-09-04T00:00:00.000Z', DueDate: '2026-09-04T00:00:00.000Z' });
        expect(result.status).toBe(true);
        expect(callsOf('findOneAndUpdate')).toHaveLength(1);
    });

    test('a start after the due date is refused before any database call', async () => {
        const result = await run({ startDate: '2026-09-06T00:00:00.000Z', DueDate: '2026-09-04T00:00:00.000Z' });
        expect(result).toEqual({ status: false, statusText: DATE_ORDER });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(HandleHistory).not.toHaveBeenCalled();
    });

    test('a due date earlier than the stored start is guarded in the filter and refused', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => {
            if (method === 'findOneAndUpdate') return null;
            if (method === 'findOne') return { _id: TASK, ...STORED };
            return null;
        });
        const result = await run({ DueDate: '2026-09-03T00:00:00.000Z' });
        expect(updateFilter().$or).toEqual([
            { startDate: null },
            { startDate: { $exists: false } },
            { startDate: { $lte: new Date('2026-09-03T00:00:00.000Z') } },
        ]);
        expect(result).toEqual({ status: false, statusText: DATE_ORDER });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(HandleHistory).not.toHaveBeenCalled();
    });

    test('a start date later than the stored due date is guarded in the filter and refused', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => {
            if (method === 'findOneAndUpdate') return null;
            if (method === 'findOne') return { _id: TASK, ...STORED };
            return null;
        });
        const result = await run({ startDate: '2026-09-11T00:00:00.000Z' });
        expect(updateFilter().$or).toEqual([
            { DueDate: null },
            { DueDate: { $exists: false } },
            { DueDate: { $gte: new Date('2026-09-11T00:00:00.000Z') } },
        ]);
        expect(result).toEqual({ status: false, statusText: DATE_ORDER });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(HandleHistory).not.toHaveBeenCalled();
    });

    test('a lone due date within the stored start is written with the counterpart guard', async () => {
        const result = await run({ DueDate: '2026-09-07T00:00:00.000Z' });
        expect(result.status).toBe(true);
        expect(updateFilter().$or[2]).toEqual({ startDate: { $lte: new Date('2026-09-07T00:00:00.000Z') } });
    });

    test('an unreadable date is refused before any database call', async () => {
        const result = await run({ startDate: 'soon', DueDate: '2026-09-04T00:00:00.000Z' });
        expect(result).toEqual({ status: false, statusText: 'Invalid date' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    test('a null due date clears the field, unsets the due date index and adds no counterpart guard', async () => {
        const result = await run({ DueDate: null });
        expect(result).toEqual({ status: true, statusText: 'Dates updated successfully' });
        const [, query] = callsOf('findOneAndUpdate')[0];
        expect(query.data[1]).toEqual({ $set: { DueDate: null }, $unset: { groupByDueDateIndex: '' } });
        expect(Object.keys(query.data[0])).toEqual(['_id']);
    });

    test('clearing both dates unsets the due date index and records the removal from the Gantt', async () => {
        const result = await run({ startDate: null, DueDate: null });
        expect(result).toEqual({ status: true, statusText: 'Dates updated successfully' });
        const [, query] = callsOf('findOneAndUpdate')[0];
        expect(query.data[1]).toEqual({
            $set: { startDate: null, DueDate: null },
            $unset: { groupByDueDateIndex: '' },
        });
        expect(HandleHistory.mock.calls[0][4].message).toBe('<b>Max</b> removed the task from the Gantt schedule.');
    });

    test('clearing only the due date unsets the due date index and keeps the start date', async () => {
        const result = await run({ DueDate: null });
        expect(result.status).toBe(true);
        const [, query] = callsOf('findOneAndUpdate')[0];
        expect(query.data[1].$unset).toEqual({ groupByDueDateIndex: '' });
        expect(query.data[1].$set).not.toHaveProperty('startDate');
    });

    test('setting dates writes no unset and records a reschedule', async () => {
        const result = await run({ startDate: '2026-09-02T00:00:00.000Z', DueDate: '2026-09-04T00:00:00.000Z' });
        expect(result.status).toBe(true);
        const [, query] = callsOf('findOneAndUpdate')[0];
        expect(query.data[1]).not.toHaveProperty('$unset');
        expect(HandleHistory.mock.calls[0][4].message).toBe('<b>Max</b> rescheduled the task on the Gantt.');
    });

    test('an empty start date clears the field', async () => {
        const result = await run({ startDate: '' });
        expect(result.status).toBe(true);
        expect(callsOf('findOneAndUpdate')[0][1].data[1]).toEqual({ $set: { startDate: null } });
    });

    test('a missing task is reported as not found after one lookup', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => null);
        const result = await run({ startDate: '2026-09-02T00:00:00.000Z', DueDate: '2026-09-04T00:00:00.000Z' });
        expect(result).toEqual({ status: false, statusText: 'Task not found' });
        expect(callsOf('findOne')).toHaveLength(1);
        expect(callsOf('findOne')[0][0]).toBe(COMPANY);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(HandleHistory).not.toHaveBeenCalled();
    });
});

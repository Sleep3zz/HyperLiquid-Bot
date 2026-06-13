const GridStrategy = require('../../src/strategy/GridStrategy');

describe('GridStrategy - _extractOrderId', () => {
    let grid;

    beforeEach(() => {
        grid = new GridStrategy(console, null, { debugMode: false });
    });

    test('returns null for null/undefined input', () => {
        expect(grid._extractOrderId(null)).toBeNull();
        expect(grid._extractOrderId(undefined)).toBeNull();
    });

    test('extracts resting order from standard response', () => {
        const res = {
            status: "ok",
            effects: [{
                ok: true,
                result: {
                    response: {
                        data: {
                            statuses: [{
                                resting: { oid: 123456789 }
                            }]
                        }
                    }
                }
            }]
        };

        const result = grid._extractOrderId(res);
        expect(result).toEqual({ oid: "123456789", status: "resting" });
    });

    test('extracts filled order', () => {
        const res = {
            status: "ok",
            effects: [{
                ok: true,
                result: {
                    response: {
                        data: {
                            statuses: [{
                                filled: { oid: "987654321" }
                            }]
                        }
                    }
                }
            }]
        };

        const result = grid._extractOrderId(res);
        expect(result).toEqual({ oid: "987654321", status: "filled" });
    });

    test('handles error status and continues', () => {
        const res = {
            status: "ok",
            effects: [{
                ok: true,
                result: {
                    response: {
                        data: {
                            statuses: [
                                { error: "Insufficient margin" },
                                { resting: { oid: 555 } }
                            ]
                        }
                    }
                }
            }]
        };

        const result = grid._extractOrderId(res);
        expect(result).toEqual({ oid: "555", status: "resting" });
    });

    test('supports flatter response shape', () => {
        const res = {
            statuses: [
                { resting: { oid: 777 } }
            ]
        };

        const result = grid._extractOrderId(res);
        expect(result).toEqual({ oid: "777", status: "resting" });
    });

    test('returns null when no valid oid is found', () => {
        const res = {
            status: "ok",
            effects: [{
                ok: true,
                result: {
                    response: {
                        data: {
                            statuses: [{ error: "Some error" }]
                        }
                    }
                }
            }]
        };

        expect(grid._extractOrderId(res)).toBeNull();
    });

    test('handles direct array of statuses', () => {
        const res = [
            { resting: { oid: 999 } }
        ];

        const result = grid._extractOrderId(res);
        expect(result).toEqual({ oid: "999", status: "resting" });
    });
});

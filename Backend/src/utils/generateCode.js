const Counter = require('../models/Counter');

// System-generated identifiers. The caller never supplies these — they are
// allocated from an atomic counter so concurrent registrations cannot collide,
// and the unique index on the field is the final guard.

// Student numbers run 1001, 1002, 1003, ... forever.
//
// The counter key is deliberately NOT scoped by year: a per-year key would
// restart at 1001 each January and collide with the previous year's numbers.
// The counter only ever increases, so deleting a student never frees their
// number for reuse.
const STUDENT_FIRST_NUMBER = 1001;

const generateStudentCode = async () => {
    const sequence = await Counter.next('student');
    return String(STUDENT_FIRST_NUMBER + sequence - 1);
};

//   Employee -> EMP-2026-0001
// The year is part of the employee key so each intake year restarts at 1 while
// the full code stays unique for all time.
const generateTeacherCode = async () => {
    const year = new Date().getFullYear();
    const sequence = await Counter.next(`employee:${year}`);
    return `EMP-${year}-${String(sequence).padStart(4, '0')}`;
};

const generateEmployeeCode = generateTeacherCode;

// A duplicate key error can still surface if a code was created outside this
// allocator (legacy data), so callers retry a small number of times.
const withRetry = async (generate, exists, attempts = 5) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const code = await generate();
        if (!(await exists(code))) return code;
    }
    throw new Error('Unable to allocate a unique identifier. Please try again.');
};

module.exports = { generateStudentCode, generateTeacherCode, generateEmployeeCode, withRetry };

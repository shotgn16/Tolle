// The features shown in the app, in menu order.
//
// To add one: create web/features/<id>/index.js (copy features/_template), import it here and add it
// to the list. The server must have a feature with the same id enabled (server/features/__init__.py);
// features the server doesn't report are hidden automatically.
import reading from './reading/index.js';
import library from './library/index.js';
import research from './research/index.js';
import insights from './insights/index.js';
import builder from './builder/index.js';
import calling from './calling/index.js';

export default [reading, library, research, insights, builder, calling];

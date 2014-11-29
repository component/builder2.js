
module.exports = Lookup;

var url = require('url');
var path = require('path');
var debug = require('debug')('component-builder:scripts:lookup');
var createManifest = require('component-manifest');

// default extensions to look up
var EXTENSIONS = [
  '',
  '.js',
  '.json',
  '/index.js',
];

var RELATIVE_PATH = /^\.{1,2}\/.*/;

function Lookup (file, opts) {
  if (!(this instanceof Lookup)) return new Lookup(file, opts);
  this.file = file;
  this.opts = opts;
  this.manifestGenerator = createManifest(opts);
}

Lookup.prototype.exec = function* (target) {
  var ret;
  target = target.toLowerCase();

  if (RELATIVE_PATH.exec(target)) {
    debug('matched relative', target);
    ret = this.relatives(target);
    if (ret != null) {
      debug('relative ' + ret);
      return ret;
    }
    return target;
  } else {
    debug('matched nonrelative ' + target)
    ret = yield* this.nonrelatives(target)
    debug('nonrelative ' + ret);
    return ret;
  }
};

Lookup.prototype.relatives = function (target, file) {
  file || (file = this.file);

  var path_ = url.resolve(file.path, target);
  var files = file.manifest.files;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    // we need this fallback to check relatives from a foreign local
    var name = f.name || path.join(f.manifest.name, path.relative(f.manifest.path, f.filename));

    for (var j = 0; j < EXTENSIONS.length; j++) {
      // check by adding extensions
      debug('check ' + f.path.toLowerCase() + ' ' + path_ + EXTENSIONS[j])
      if (f.path.toLowerCase() === path_ + EXTENSIONS[j]) return name;
    }
    // check by removing extensions
    if (f.path.replace(/\.\w+$/, '').toLowerCase() === path_) return name;
  };

  var message = 'ignore "' + target + '" , could not resolve from "' + file.branch.name + '"\'s file "' + file.path + '"';
  debug(message);

  return null;
};

Lookup.prototype.nonrelatives = function* (target) {
  var frags = tofrags(target);
  var head = frags[0], tail = frags[1];
  var ret;

  ret = this.aliases.apply(this, frags)

  if (ret != null)
    return ret;

  ret = yield* this.locals(target);
  if (ret != null)
    return ret;

  var deps = this.file.branch.dependencies;
  var names = Object.keys(deps);
  var name, repo;

  // <repo>
  for (var i = 0; i < names.length; i++) {
    name = names[i];
    repo = name.split('/')[1];
    if (repo === head) {
      return deps[name].canonical + tail;
    }
  }
  debug('target ' + target)

  var dep;

  // component.json name, if different than repo
  for (var i = 0; i < names.length; i++) {
    name = names[i];
    dep = deps[name];
    if (dep.node.name.toLowerCase() === head) {
      return dep.canonical + tail;
    }
  }

  // to do: look up stuff outside the dependencies
  debug('could not resolve "%s" from "%s"', target, this.file.name);
  return target;
};

Lookup.prototype.aliases = function (head, tail) {
  var deps = this.file.branch.dependencies;
  var name;

  function fn (canonical) {
    if (tail)
      return [canonical, tail].join('/');
    else
      return canonical;
  }

  if (~head.indexOf('~')) { // <user>~<repo>
    name = head.replace('~', '/');
    if (deps[name])
      return fn(deps[name].canonical);
  } else if (~head.indexOf('-')) { // <user>-<repo>
    var names = Object.keys(deps);
    for (var i = 0; i < names.length; i++) {
      name = names[i];
      if (head === name.replace('/', '-'))
        return fn(deps[name].canonical);
    }
  }

  return null;
};

Lookup.prototype.foreignRelative = function* (branch, relativeFile) {
  if (typeof branch !== 'object')
    throw new Error('branch must be supplied');

  var manifest = yield* this.manifestGenerator(branch);

  var dummy = {
    path: '', // it should simulate a url-relative path
    manifest: manifest,
    branch: branch
  };

  // resolve the file (if extension is not provided)
  var resolved = this.relatives(relativeFile, dummy);
  if (resolved == null) return null;

  var relative = path.relative(manifest.name, resolved);

  return relative;
};

Lookup.prototype.locals = function* (target) {
  var deps = this.file.branch.locals;
  var keys = Object.keys(deps);
  var match, re, i = 0;

  for (; i < keys.length; i++) {
    re = new RegExp("^(" + keys[i] + ")(/.*)?$");

    if (match = re.exec(target)) {
      var head = match[1];
      var tail = match[2] || '';
      var canonical = deps[head].canonical;

      if (tail !== '') {
        var relativeFile = '.' + tail;
        var resolvedTail = yield* this.foreignRelative(deps[head], relativeFile);
        if (resolvedTail != null) {
          debug('resolved relative file for local "' + head + '/' + resolvedTail + '"');
          return canonical + '/' + resolvedTail;
        }
      }

      return canonical + tail;
    }
  }
};

function tofrags (target) {
  var frags = target.split('/');
  var head = frags[0];
  var tail = frags.length > 1
    ? frags.slice(1).join('/')
    : '';
  return [head, tail];
}
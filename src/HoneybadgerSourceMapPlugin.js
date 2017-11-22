import async from 'async';
import request from 'request';
import VError from 'verror';
import find from 'lodash.find';
import reduce from 'lodash.reduce';
import { handleError, validateOptions } from './helpers';
import { ENDPOINT } from './constants';

class HoneybadgerSourceMapPlugin {
  constructor({
    api_key,
    assets_url,
    revision = "master",
    silent = false,
    ignoreErrors = false,
    source_map
  }) {
    this.api_key = api_key;
    this.assets_url = assets_url;
    this.revision = revision;
    this.silent = silent;
    this.ignoreErrors = ignoreErrors;
    this.source_map = source_map;
  }

  afterEmit(compilation, done) {
    const errors = validateOptions(this);

    if (errors) {
      compilation.errors.push(...handleError(errors));
      return done();
    }

    this.uploadSourceMaps(compilation, (err) => {
      if (err) {
        if (!this.ignoreErrors) {
          compilation.errors.push(...handleError(err));
        } else if (!this.silent) {
          compilation.warnings.push(...handleError(err));
        }
      }
      done();
    });
  }

  apply(compiler) {
    compiler.plugin('after-emit', this.afterEmit.bind(this));
  }

  getAssets(compilation) {
    const { chunks } = compilation.getStats().toJson();

    return reduce(chunks, (result, chunk) => {
      const chunkName = chunk.names[0];

      const sourceFile = find(chunk.files, file => /\.js$/.test(file));
      const sourceMap = find(chunk.files, file => /\.js\.map$/.test(file));

      if (!sourceFile || !sourceMap) {
        return result;
      }

      return [
        ...result,
        { sourceFile, sourceMap }
      ];
    }, {});
  }

  uploadSourceMap(compilation, { sourceFile, sourceMap }, done) {
    const req = request.post(ENDPOINT, (err, res, body) => {
      if (!err && res.statusCode === 201) {
        if (!this.silent) {
          console.info(`Uploaded ${sourceMap} to Honeybadger API`); // eslint-disable-line no-console
        }
        return done();
      }

      const errMessage = `failed to upload ${sourceMap} to Honeybadger API`;
      if (err) {
        return done(new VError(err, errMessage));
      }

      try {
        const { error } = JSON.parse(body);
        return done(new Error(error ? `${errMessage}: ${error}` : errMessage));
      } catch (parseErr) {
        return done(new VError(parseErr, errMessage));
      }
    });

    const form = req.form();
    form.append('api_key', this.api_key);
    form.append('minified_url', `${this.assets_url}/${sourceFile}`);
    form.append('minified_file', compilation.assets[sourceFile].source(), {
      filename: sourceFile,
      contentType: 'application/javascript'
    });
    form.append('source_map', compilation.assets[sourceMap].source(), {
      filename: sourceMap,
      contentType: 'application/octet-stream'
    });
    form.append('revision', this.revision);
  }

  uploadSourceMaps(compilation, done) {
    const assets = this.getAssets(compilation);
    const upload = this.uploadSourceMap.bind(this, compilation);

    async.each(assets, upload, (err, results) => {
      if (err) {
        return done(err);
      }
      return done(null, results);
    });
  }
}

module.exports = HoneybadgerSourceMapPlugin;

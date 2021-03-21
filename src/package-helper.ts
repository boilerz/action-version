import fs from 'fs';
import path from 'path';
import process from 'process';

import * as core from '@actions/core';

const readFileAsync = fs.promises.readFile;

export enum Registry {
  NPM = 'https://registry.npmjs.org',
  GITHUB = 'https://npm.pkg.github.com',
}

interface PackageJson {
  version: string;
  devDependencies: Record<string, string>;
}

async function getPackageJson(): Promise<PackageJson> {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  core.debug(`📦 package.json path: ${packageJsonPath}`);

  const packageData: string = await readFileAsync(packageJsonPath, 'utf8');
  return JSON.parse(packageData);
}

export async function getCurrentVersion(): Promise<string> {
  const { version } = await getPackageJson();
  return version;
}

export async function getDevDependencies(): Promise<string[]> {
  const { devDependencies } = await getPackageJson();

  return Object.keys(devDependencies || {});
}

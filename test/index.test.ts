import 'mocha';
import { K8sLock } from '../src';
import { expect } from './expect';
import { exec } from 'child-process-promise';

describe('K8sLock', () => {
  beforeEach(async () => {
    await exec('kubectl delete configmap testlock.com --ignore-not-found=true');
  })

  after(async () => {
    await exec('kubectl delete configmap testlock.com --ignore-not-found=true');
  })

  it('should get a lock when no configmap exists', async () => {
    const k8sLock = new K8sLock();
    const success = await k8sLock.aquireLock('default', 'testlock.com', 'test');
    expect(success).to.be.true;
  })

  it('should get and release a lock', async () => {
    const k8sLock = new K8sLock();
    expect(await k8sLock.aquireLock('default', 'testlock.com', 'test')).to.be.true;
    expect(await k8sLock.releaseLock('default', 'testlock.com', 'test')).to.be.true;
  })

  it('should reaquire a lock after releasing', async () => {
    const k8sLock = new K8sLock();
    expect(await k8sLock.aquireLock('default', 'testlock.com', 'test')).to.be.true;
    expect(await k8sLock.releaseLock('default', 'testlock.com', 'test')).to.be.true;
    expect(await k8sLock.aquireLock('default', 'testlock.com', 'test')).to.be.true;
  })

  it('should return false when lock is locked', async () => {
    const k8sLock = new K8sLock();
    expect(await k8sLock.aquireLock('default', 'testlock.com', 'test')).to.be.true;
    expect(await k8sLock.aquireLock('default', 'testlock.com', 'test')).to.be.false;
  })
});

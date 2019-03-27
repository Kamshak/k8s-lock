import { Config, KubeConfig, Core_v1Api, V1ConfigMap } from '@kubernetes/typescript-node';
import * as fs from 'fs';
import * as path from 'path';
import * as requestPromise from 'request-promise-native';
import * as retry from 'bluebird-retry';

// Retry rate limited kubeapi calls
const retryOnRateLimit = {
  predicate: err => err.statusCode && err.statusCode == 429,
  retryInterval: 500 + (Math.random() - 0.5) * 500,
  retryCount: 15,
  retryBackoff: 2,
};

class ManualRequestAuthenticator {
  public applyToRequest: (request) => void;
  constructor(public basePath: string) {}
  setDefaultAuthentication(auth: { applyToRequest: (request) => void}) {
    this.applyToRequest = (request) => auth.applyToRequest(request);
  }
}

type KubeApi =  {
  new(basePath?: string): { 
    setDefaultAuthentication(auth: {
      applyToRequest: (request) => void
    })
  };
};

export class K8sLock {
  public static SERVICEACCOUNT_ROOT = '/var/run/secrets/kubernetes.io/serviceaccount';
  public static SERVICEACCOUNT_CA_PATH = Config.SERVICEACCOUNT_ROOT + '/ca.crt';
  public static SERVICEACCOUNT_TOKEN_PATH = Config.SERVICEACCOUNT_ROOT + '/token';

  private readonly coreApi: Core_v1Api;
  private readonly authenticator: ManualRequestAuthenticator;

  constructor() {
    [this.coreApi, this.authenticator] = K8sLock.defaultClient([
      Core_v1Api,
      ManualRequestAuthenticator
    ]);
  }

  public static fromFile(filename: string) {
    let kc = new KubeConfig();
    kc.loadFromFile(filename);

    return (apiClass: KubeApi) => {
      const api = new apiClass(kc.getCurrentCluster()['server']);
      api.setDefaultAuthentication(kc);
      return api;
    }
  }

  public static fromCluster() {
    let host = process.env.KUBERNETES_SERVICE_HOST
    let port = process.env.KUBERNETES_SERVICE_PORT

    // TODO: better error checking here.
    let caCert = fs.readFileSync(Config.SERVICEACCOUNT_CA_PATH);
    let token = fs.readFileSync(Config.SERVICEACCOUNT_TOKEN_PATH);

    return (apiClass: KubeApi) => {
      const api = new apiClass('https://' + host + ':' + port);
      api.setDefaultAuthentication({
        'applyToRequest': (opts) => {
          opts.ca = caCert;
          opts.headers['Authorization'] = 'Bearer ' + token;
        }
      });
      return api;
    }
  }

  public static defaultClient(apiClasses: KubeApi[]) {
    let loader;
    if (process.env.KUBECONFIG) {
      loader = K8sLock.fromFile(process.env.KUBECONFIG);
    }

    let config = path.join(process.env.HOME, ".kube", "config");
    if (fs.existsSync(config)) {
      loader = K8sLock.fromFile(config);
    }

    if (fs.existsSync(Config.SERVICEACCOUNT_TOKEN_PATH)) {
      loader = K8sLock.fromCluster();
    }

    return apiClasses.map(apiClass => {
      return loader(apiClass);
    });
  }

  async aquireLock(
    namespace: string,
    lockName: string,
    leaserName: string,
  ) {
    // Check if lock is held by other person
    let configMap: V1ConfigMap;
    try {
      let result = await retry(() => this.coreApi.readNamespacedConfigMap(lockName, namespace), retryOnRateLimit);
      configMap = result.body;
    } catch (e) {
      if (e.body.reason === 'NotFound') {
        await retry(() => this.coreApi.createNamespacedConfigMap(namespace, {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: {
            name: lockName,
          } as any,
          data: {
            locked: leaserName
          }
        }), retryOnRateLimit);
        return true;
      }
      throw new Error(e.body.message);
    }

    const isLocked = configMap.data['locked'] !== 'false';
    if (isLocked) {
      return false;
    }

    // Try to aquire lock
    const opts = {
      method: 'PATCH',
      uri: `${this.authenticator.basePath}/api/v1/namespaces/${namespace}/configmaps/${lockName}`,
      json: [
        { "op": "replace", "path": "/data/locked", "value": "false" },
        { "op": "replace", "path": "/metadata/resourceVersion", "value": configMap.metadata.resourceVersion }
      ],
      headers: {
        'Content-Type': 'application/json-patch+json'
      }
    };
    this.authenticator.applyToRequest(opts);
    await retry(() => requestPromise(opts), retryOnRateLimit);
    return true;
  }

  async releaseLock(
    namespace: string,
    lockName: string,
    leaserName: string,
  ) {
    const { body } = await retry(() => this.coreApi.readNamespacedConfigMap(lockName, namespace), retryOnRateLimit);
    const isLockedByUs = body.data['locked'] === leaserName;
    if (!isLockedByUs) {
      throw new Error('Cannot release lock that is not held by us. Current leaser is' + body.data['locked']);
    }

    // Release lock
    const opts = {
      method: 'PATCH',
      uri: `${this.authenticator.basePath}/api/v1/namespaces/${namespace}/configmaps/${lockName}`,
      json: [
        { "op": "replace", "path": "/data/locked", "value": "false" },
        { "op": "replace", "path": "/metadata/resourceVersion", "value": body.metadata.resourceVersion }
      ],
      headers: {
        'Content-Type': 'application/json-patch+json'
      }
    };
    this.authenticator.applyToRequest(opts);
    await retry(() => requestPromise(opts), retryOnRateLimit);
    return true;
  }
}
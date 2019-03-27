To Debug this app:

1) In Integration deploy the chart for the deployment api: yarn deploy:api
2) Make the redis available locally: kubectl port-forward "$(kubectl get pod --selector=app=integration-testing-redis -o jsonpath='{.items..metadata.name}')" 6379
3) Start in debug: PORT=3000 yarn start:watch
# HedgeFarm Alpha #1 | Contracts

Alpha #1 is our first released vault that enable users to generates returns on stablecoin regardless of the market direction while reducing drawdowns.
This vault runs a DeFI CPPI strategy.

### Installation

Before setting up, please install the dependencies through `npm i`.

### Setup

This repository contains the contracts used for the Alpha #1 vault and its tests.

It is built on top of `hardhat`.

You will need to add your own environment varibles. You can copy the `.env.example` file as `.env` and fill the required parameters.

You can compile with: `npx hardhat compile`. If you get some errors with the tasks, comment the lines 10 to 19 in `hardhat.config.ts` which are importing the tasks, compile and then uncomment them.

### Tests

All the tests can be found in the `test/` folder. You can run them separately by executing `npx hardhat test test/<file_name>.ts`

### Coverage

The tests coverage can be generated through this command: `npx hardhat coverage`. The results will be in the `coverage` folder.

### Deployment

A set of tasks is made available in the `tasks/` folder to deploy the contracts.

### Links

- [HedgeFarm](https://hedgefarm.finance)
- [HedgeFarm Docs](https://docs.hedgefarm.finance)
- [Discord](https://discord.com/invite/b57NTqH7SG)
- [Twitter](https://twitter.com/hedge_farm)
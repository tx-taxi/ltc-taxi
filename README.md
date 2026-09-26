<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/src/resources/branding/ltc-dark-full.svg">
    <img src="frontend/src/resources/branding/ltc-light-full.svg" width="360" alt="ltc.tx.taxi banner logo">
  </picture>
</p>

<h1 align="center">Litecoin Explorer · ltc.tx.taxi</h1>

<p align="center">
  A public Litecoin block explorer, mempool visualizer, and API.<br>
  <a href="https://ltc.tx.taxi">Open ltc.tx.taxi</a>
</p>

## Overview

[ltc.tx.taxi](https://ltc.tx.taxi) is a Litecoin explorer in the [tx.taxi](https://tx.taxi) network. It presents Litecoin mainnet data through a Litecoin-specific interface and a read-only API gateway.

## Features

- Litecoin mainnet-only configuration, with LTC and litoshi denominations.
- Read-only inspection of blocks, transactions, and transparent-address history.
- Live mempool, fee, mining, and chain-statistics views, including the enabled Litecoin mining dashboard and historical price view.
- A provider-backed gateway with a live WebSocket feed, cached responses, basic provider health information, and limited independent tip/block fallback.
- Litecoin-branded pages and entity metadata. MWEB amounts remain private; transparent-chain data is the scope of address and transaction presentation.

## Development

The supported local review path is the repository script. It starts Angular on `127.0.0.1:4311`, the Litecoin adapter on `127.0.0.1:9332`, and exposes the combined review site at `http://127.0.0.1:4310`.

```sh
npm ci --prefix frontend
npm ci --prefix adapter
./scripts/local-start.sh
```

`local-start.sh` also expects the sibling `../ltc-router-review` checkout, with its dependencies installed, for local tx.taxi routing. Stop only this project's processes with:

```sh
./scripts/local-stop.sh
```

The adapter defaults to `https://litecoinspace.org` through `LTC_PROVIDER`. Set `LTC_PROVIDER` to a compatible Litecoin explorer API when a different data source is required. A self-managed provider must expose the REST and WebSocket endpoints used by the adapter and be backed by synchronized Litecoin network data; a Litecoin full node and address indexer are therefore external prerequisites of that provider, not services bundled by this repository.

Build the container image locally with the checked-in production configuration:

```sh
docker build -t ltc-explorer .
```

The image builds the frontend and serves it through the adapter. It still requires its configured external Litecoin data provider at runtime. The image pins Node.js 24; use a compatible Node.js and npm installation for the local commands above.

## Attribution and license

This repository adapts the [Mempool Open Source Project](https://github.com/mempool/mempool) for Litecoin in the tx.taxi network. The original top-level README is retained in [UPSTREAM_README.md](UPSTREAM_README.md) for provenance.

The code is distributed under the terms in [LICENSE](LICENSE) and [COPYING.md](COPYING.md), including the GNU Affero General Public License v3 text and applicable trademark notices.

The software license does not grant trademark rights to the tx.taxi name or logos. Independent deployments should use their own branding and must not imply they are operated or endorsed by tx.taxi.

## Links

- [Live explorer](https://ltc.tx.taxi)
- [tx.taxi hub](https://tx.taxi)
- [Telegram channel](https://t.me/txtaxi)

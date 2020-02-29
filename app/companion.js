import hex from 'hex-string';
import AppState from './components/AppState';
import Utils from './utils/utils';

/* eslint-disable class-methods-use-this */
const WebSocket = window.require('ws');

export default class CompanionAppListener {
  wss = null;

  fnGetState: () => AppState = null;

  fnSendTransaction: ([], (string, string) => void) => void = null;

  constructor(fnGetSate: () => AppState, fnSendTransaction: ([], (string, string) => void) => void) {
    this.fnGetState = fnGetSate;
    this.fnSendTransaction = fnSendTransaction;
  }

  setUp() {
    this.wss = new WebSocket.Server({ port: 7070 });

    this.wss.on('connection', ws => {
      ws.on('message', message => {
        console.log(`Received message => ${message}`);
        const cmd = JSON.parse(message);

        if (cmd.command === 'getInfo') {
          const response = this.doGetInfo();
          ws.send(response);
        } else if (cmd.command === 'getTransactions') {
          const response = this.doGetTransactions();
          ws.send(response);
        } else if (cmd.command === 'sendTx') {
          const response = this.doSendTransaction(cmd, ws);
          ws.send(response);
        }
      });
    });
  }

  doGetInfo(): string {
    const appState = this.fnGetState();

    const saplingAddress = appState.addresses.find(a => Utils.isSapling(a));
    const tAddress = appState.addresses.find(a => Utils.isTransparent(a));
    const balance = parseFloat(appState.totalBalance.total);
    const maxspendable = parseFloat(appState.totalBalance.total);
    const maxzspendable = parseFloat(appState.totalBalance.private);
    const tokenName = appState.info.currencyName;
    const zecprice = parseFloat(appState.info.zecPrice);

    const resp = {
      version: 1.0,
      command: 'getInfo',
      saplingAddress,
      tAddress,
      balance,
      maxspendable,
      maxzspendable,
      tokenName,
      zecprice,
      serverversion: '0.9.2'
    };

    return JSON.stringify(resp);
  }

  doGetTransactions(): string {
    const appState = this.fnGetState();

    let txlist = [];
    if (appState.transactions) {
      // Get only the last 20 txns
      txlist = appState.transactions.slice(0, 20).map(t => {
        let memo = t.detailedTxns && t.detailedTxns.length > 0 ? t.detailedTxns[0].memo : '';
        if (memo) {
          memo = memo.trimRight();
        } else {
          memo = '';
        }

        const txResp = {
          type: t.type,
          datetime: t.time,
          amount: t.amount.toFixed(8),
          txid: t.txid,
          address: t.address,
          memo,
          confirmations: t.confirmations
        };

        return txResp;
      });
    }

    const resp = {
      version: 1.0,
      command: 'getTransactions',
      transactions: txlist
    };

    return JSON.stringify(resp);
  }

  doSendTransaction(cmd: any, ws: WebSocket): string {
    // "command":"sendTx","tx":{"amount":"0.00019927","to":"zs1pzr7ee53jwa3h3yvzdjf7meruujq84w5rsr5kuvye9qg552kdyz5cs5ywy5hxkxcfvy9wln94p6","memo":""}}
    const inpTx = cmd.tx;
    const appState = this.fnGetState();

    const sendingAmount = parseFloat(inpTx.amount);

    const buildError = (reason: string): string => {
      const resp = {
        errorCode: -1,
        errorMessage: `Couldn't send Tx:${reason}`
      };

      console.log('sendtx error', resp);
      return JSON.stringify(resp);
    };

    // First, find an address that can send the correct amount.
    const fromAddress = appState.addressesWithBalance.find(ab => ab.balance > sendingAmount);
    if (!fromAddress) {
      return buildError(`No address with sufficient balance to send ${sendingAmount}`);
    }

    let memo = !inpTx.memo || inpTx.memo.trim() === '' ? null : inpTx.memo;
    const textEncoder = new TextEncoder();
    memo = memo ? hex.encode(textEncoder.encode(memo)) : '';

    // Build a sendJSON object
    const sendJSON = [];
    sendJSON.push(fromAddress.address);
    if (memo) {
      sendJSON.push([{ address: inpTx.to, amount: sendingAmount, memo }]);
    } else {
      sendJSON.push([{ address: inpTx.to, amount: sendingAmount }]);
    }
    console.log('sendjson is', sendJSON);

    this.fnSendTransaction(sendJSON, (title, msg) => {
      let resp;
      if (title.startsWith('Success')) {
        const arr = msg.split(' ');
        const txid = arr && arr.length > 0 && arr[arr.length - 1];

        resp = {
          version: 1.0,
          command: 'sendTxSubmitted',
          txid
        };
      } else {
        resp = {
          version: 1.0,
          command: 'sendTxFailed',
          err: msg
        };
      }

      console.log('Callback sending', resp);
      ws.send(JSON.stringify(resp));
    });

    // After the transaction is submitted, we return an intermediate success.
    const resp = {
      version: 1.0,
      command: 'sendTx',
      result: 'success'
    };

    console.log('sendtx sending', resp);
    return JSON.stringify(resp);
  }
}

/**
 * Copyright 2019 Ambrosus Inc.
 * Email: tech@ambrosus.com
 */

const Web3 = require('web3');
const fs = require("fs");
const Tx = require('ethereumjs-tx');

let configFile = fs.readFileSync("./Oracle/Oracle.conf");
let config = JSON.parse(configFile);

//global params
const MY_ADDRESS = config.address;
const MY_PRIVATE_KEY = Buffer.from(config.key, 'hex');
const MAINNET_URL = config.mainnet;
const SIDECHAIN_URL = config.sidechain;
const BRIDGE_MAIN_ADDRESS = config.bridge.mainAddress;
const BRIDGE_SIDE_ADDRESS = config.bridge.sideAddress;

const BRIDGE_SOURCE_FILE = config.bridgeContract;

const web3_main = new Web3(new Web3.providers.WebsocketProvider(MAINNET_URL));
const web3_side = new Web3(new Web3.providers.WebsocketProvider(SIDECHAIN_URL));

// contracts json contains compiled bridge contract
let source = fs.readFileSync(BRIDGE_SOURCE_FILE);
let contract_json = JSON.parse(source);

let abi = contract_json.abi;

async function sendAcceptMessage(web3_to, bridge_to, returnValues) {
    try {
        let bridge_dest = web3_to.eth.Contract(abi, bridge_to);
        console.log("Accepting message");
        let abiData = bridge_dest.methods.acceptMessage(returnValues.sender, returnValues.recipient, returnValues.data).encodeABI();
        let nonce = await web3_to.eth.getTransactionCount(MY_ADDRESS);
        const rawTx = {
            nonce: nonce,
            from: MY_ADDRESS,
            data: abiData,
            to: bridge_to,
            gasPrice: '0x09184e72a000',
            gasLimit: '0x5AA710',
          };
        const tx = new Tx(rawTx);
        tx.sign(MY_PRIVATE_KEY);
        let receipt = await web3_to.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex'))
        return {tx: receipt.transactionHash, status: receipt.status};
    } catch (error) {
        console.log(error.toString());
    }
}

function setEventListener(web3_from, bridge_from, web3_to, bridge_to) {
    let bridge = web3_from.eth.Contract(abi, bridge_from);
    let subscription = bridge.events.Message().on('data', (event) => {
        console.log("Event on " + web3_from.currentProvider.host);
        console.log("Data:", event.returnValues.data);
        console.log("From:", event.returnValues.sender);
        console.log("To:", event.returnValues.recipient);
        sendAcceptMessage(web3_to, bridge_to, event.returnValues).then(value => {
            console.log(value);
        });
    });
    return subscription;
}

async function run() {
    console.log("Starting to listen for events");

    let subscription_main = setEventListener(web3_main, BRIDGE_MAIN_ADDRESS, web3_side, BRIDGE_SIDE_ADDRESS);
    let subscription_side = setEventListener(web3_side, BRIDGE_SIDE_ADDRESS, web3_main, BRIDGE_MAIN_ADDRESS);

    return {main: subscription_main, side: subscription_side};
}

run().then((subscriptions) => {
    //console.log('Press any key to exit');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => {
        let p1 = new Promise((resolve, reject) => {
            subscriptions.main.unsubscribe((error, success) => {
                if (success) {
                    console.log('Successfully unsubscribed!');
                    resolve();
                } else {
                    reject(error);
                }
            });
        });
        let p2 = new Promise((resolve, reject) => {
            subscriptions.side.unsubscribe((error, success) => {
                if (success) {
                    console.log('Successfully unsubscribed!');
                    resolve();
                } else {
                    reject(error);
                }
            });
        });

        Promise.all([p1, p2]).then(() => {
            return process.exit(0);
        });
    });
})
.catch(err => {
    console.log(err);
});

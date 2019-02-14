const Web3 = require('web3');
const fs = require("fs");
const Tx = require('ethereumjs-tx');

//global params
var myAddress = '0xC14BbA1b6CC582BBB6B554a5c0821C619CFD42c4';
var privateKey = Buffer.from('099e8dc1316d838865648e3df3698e7a2037b6c81f270cc075a415b4a8ca6270', 'hex');
var bridge_main = "0xd3f12763cb93507e782c94d66648c76292461920";
var bridge_side = "0x47a518a0e60f2308f3e6173059a57d7b62cbf500";
var main = 'ws://localhost:8546';
var side = 'ws://localhost:8548';
var contract_source = "./bin/BridgeMain.json"

const web3_main = new Web3(new Web3.providers.WebsocketProvider(main));
const web3_side = new Web3(new Web3.providers.WebsocketProvider(side));

// contracts json contains compiled bridge contract
let source = fs.readFileSync(contract_source);
let contract_json = JSON.parse(source);

let abi = contract_json.abi;

async function sendAcceptMessage(web3_to, bridge_to, returnValues) {
    try {
        let bridge_dest = web3_to.eth.Contract(abi, bridge_to);
        console.log("Accepting message");
        let abiData = bridge_dest.methods.acceptMessage(returnValues.sender, returnValues.recipient, returnValues.data).encodeABI();
        let nonce = await web3_to.eth.getTransactionCount(myAddress);
        const rawTx = {
            nonce: nonce,
            from: myAddress,
            data: abiData,
            to: bridge_to,
            gasPrice: '0x09184e72a000',
            gasLimit: '0x5AA710',
          };
        const tx = new Tx(rawTx);
        tx.sign(privateKey);
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

    let subscription_main = setEventListener(web3_main, bridge_main, web3_side, bridge_side);
    let subscription_side = setEventListener(web3_side, bridge_side, web3_main, bridge_main);

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

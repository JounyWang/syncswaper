const { Wallet, Provider } = require('zksync-web3');
// const zksync = require('zksync-web3');
const ethers = require('ethers');
const { defaultAbiCoder } = require('ethers').utils;
const { BigNumber } = require('ethers');
const { approveToken } = require('./erc20utils');
const fs = require('fs');
const { convertCSVToObjectSync, sleep, getRandomFloat, saveLog } = require('./utils');
const { count } = require('console');

const zksrpc = 'https://mainnet.era.zksync.io';
const ethereumrpc = 'https://eth-mainnet.g.alchemy.com/v2/qRnk4QbaEmXJEs5DMnhitC0dSow-qATl';
const provider = new Provider(zksrpc);
const ethereumProvider = new ethers.getDefaultProvider(ethereumrpc);

// Set token address

// const wETHAddress = '0x20b28b1e4665fff290650586ad76e977eab90c5d';
// const usdcAddress = '0xfcEd12dEbc831D3a84931c63687C395837D42c2B';
// const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const wETHAddress = '0x5aea5775959fbc2557cc8789bc1bf90a239d9a91';
const usdcAddress = '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETH_ADDRESS = '0x000000000000000000000000000000000000800A';

// Set contract address

// const factoryAddress = '0xf2FD2bc2fBC12842aAb6FbB8b1159a6a83E72006';
// const routerAddress = '0xB3b7fCbb8Db37bC6f572634299A58f51622A847e';
const factoryAddress = '0xf2DAd89f2788a8CD54625C60b55cD3d2D0ACa7Cb';
const routerAddress = '0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295';
// -----------------------------------------

// Set project name for logging purposes
const projectName = 'SyncSwap';
// Set maximum GAS price, program doesn't execute if mainnet GAS is higher than this value
const maxGasPrice = 40;
// Set random transaction amount percentages
const minAmountPct = 0.2;
const maxAmountPct = 0.3;

// Set random interval time range for accounts
const minSleepTime = 1;
const maxSleepTime = 5;

// Set wallet file path
const walletPath = './data/walletData.csv';


// Program starts running
console.log('Opening wallet file...');

// Open address file
const walletData = convertCSVToObjectSync(walletPath);

async function tokenSwap(poolAddress, tokenIn, amountIn, wallet){
    // Transaction mode:
    // 1 - Withdraw and unwrap to native ETH
    // 2 - Withdraw and wrap to wETH
    const withdrawMode = 1;
    // console.log(wallet.address);
    // process.exit();

    // Build transaction parameters
    const swapData = defaultAbiCoder.encode(
        ["address", "address", "uint8"],
        [tokenIn, wallet.address, withdrawMode]
    );
    const steps = [{
        pool: poolAddress,
        data: swapData,
        callback: ZERO_ADDRESS, // we don't have a callback
        callbackData: '0x',
    }];

    if (tokenIn === wETHAddress){
        tokenIn = ZERO_ADDRESS;
    };
    const paths = [{
        steps: steps,
        tokenIn: tokenIn,
        amountIn: amountIn,
    }];
 
    // Create router contract
    const routerABI = JSON.parse(fs.readFileSync('./ABI/SyncSwapRouter.json'));
    const router = new ethers.Contract(routerAddress, routerABI, wallet);
    
    // params
    const params = {};
    // When paying with native ETH, the value parameter needs to be passed
    if (paths[0].tokenIn === ZERO_ADDRESS){
        params.value = amountIn
    };
    // Get gas price
    params.gasPrice = await provider.getGasPrice();
    // Estimate gas limit required for the transaction
    params.gasLimit = await router.estimateGas.swap(paths, 0, BigNumber.from(Math.floor(Date.now() / 1000)).add(1800), params);

    // Start exchange
    const response = await router.swap(
        paths,
        0,
        BigNumber.from(Math.floor(Date.now() / 1000)).add(1800),
        params
    );
    // console.log(response)
    const tx = await response.wait();
    return tx;
}

async function main() {
    // Query Pool contract address
    const factoryABI = JSON.parse(fs.readFileSync('./ABI/BasePoolFactory.json'));
    const classicPoolFactory = new ethers.Contract(factoryAddress, factoryABI, provider);
    console.log('Fetching Pool contract address...');
    const poolAddress = await classicPoolFactory.getPool(wETHAddress, usdcAddress);
    console.log(`Successfully fetched Pool contract address: ${poolAddress}`);

    console.log('Starting loop...');
    for (wt of walletData) {

        // Loop to get GAS
        while (true) {
            console.log('Fetching current mainnet GAS');
            const gasPrice = parseFloat(ethers.utils.formatUnits(await ethereumProvider.getGasPrice(), 'gwei'));
            console.log(`Current gasPrice: ${gasPrice}`);
            if (gasPrice > maxGasPrice) {
                console.log(`gasPrice exceeds the set maximum value of ${maxGasPrice}, pausing the program for 30 minutes`);
                await sleep(30);
            } else {
                console.log(`gasPrice is below ${maxGasPrice}, program continues execution`);
                break;
            };
        }

        console.log(`Account: ${wt.Wallet}, Address: ${wt.Address}, executing transactions...`);
        // Create wallet
        const wallet = new Wallet(wt.PrivateKey).connect(provider).connectToL1(ethereumProvider);
        // Check account balance
        console.log('Fetching account ETH balance.')
        const ethBalance = parseFloat(ethers.utils.formatEther(await wallet.getBalance(ETH_ADDRESS)));
        console.log(`Successfully fetched account ETH balance, balance: ${ethBalance}`);
        const minAmount = ethBalance * minAmountPct;
        const maxAmount = ethBalance * maxAmountPct;

        // continue;

        // Set random transaction amount
        const randomAmount = getRandomFloat(minAmount, maxAmount).toFixed(16);
        // const randomAmount = 0.001;
        const tradingamount = ethers.utils.parseEther(randomAmount.toString());
        console.log(`trading Amount ${tradingamount}`)

        // Sell ETH, get USDC
        console.log('Selling ETH')
        let tx = await tokenSwap(poolAddress, wETHAddress, tradingamount, wallet);
        console.log(`Transaction successful, hash: ${tx.transactionHash}`);

        console.log('Pause for 1 minute before continuing');
        await sleep(1);

        // Check USDC balance
        console.log('Fetching USDC balance...');

        const tokenBalance = await provider.getBalance(wallet.address, "latest", usdcAddress);
        console.log(`Query successful, USDC balance: ${tokenBalance}, initiating authorization...`);

        // Authorize USDC
        const txReceipt = await approveToken(wallet, usdcAddress, routerAddress, tokenBalance);
        console.log('Authorization successful, hash:', txReceipt.transactionHash);

        // console.log('Pause for 1 minute before continuing');
        // await sleep(1);

        console.log('Buying ETH with USDC...')
        // Sell USDC, get ETH
        tx = await tokenSwap(poolAddress, usdcAddress, tokenBalance, wallet);
        console.log(`Transaction successful, hash: ${tx.transactionHash}`);

        // Save logs
        const currentTime = new Date().toISOString();
        const logMessage = `Transaction successful - Time: ${currentTime}, Wallet Name: ${wt.Wallet}, Wallet Address: ${wallet.address}`;
        saveLog(projectName, logMessage);
        // Pause
        const sleepTime = getRandomFloat(minSleepTime, maxSleepTime).toFixed(1); 
        console.log(logMessage, 'Program paused for',sleepTime,'minutes before continuing execution');
        await sleep(sleepTime);

    }

}


main()

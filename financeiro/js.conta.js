$(function () {

    $('#z3').append(`
    <div class="col-sm-12">
        <div class="description-block">
            <h5 id="saldoatual" class="description-header" style="font-size: 30px;">0,00</h5>
            <span>Saldo Atual</span>
        </div>
    </div>
    `);

    if (application.functions.getId() > 0) {
        application.jsfunction('sipfinancas.financeiro.conta.js_saldoAtual', { idconta: application.functions.getId() }, function (response) {
            if (response.success) {
                $('#saldoatual').text(response.data);
            }
        });
    }

});